import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@photoo/db';
import type { BookingStatus } from '@photoo/shared';
import { Logger } from 'nestjs-pino';
import { z } from 'zod';
import { transitionBooking } from '../bookings/booking-state.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { ledgerTotals, reversibleCents } from './booking-ledger.js';
import type { AfterCommit } from './stripe-connect.service.js';
import type { GatewayEvent } from './stripe/stripe-gateway.js';

export interface MoneyEventOutcome {
  status: 'processed' | 'deferred';
  afterCommit: AfterCommit;
}

const NOTHING_AFTER_COMMIT: AfterCommit = () => Promise.resolve();
const PROCESSED: MoneyEventOutcome = { status: 'processed', afterCommit: NOTHING_AFTER_COMMIT };
const DEFERRED: MoneyEventOutcome = { status: 'deferred', afterCommit: NOTHING_AFTER_COMMIT };

const CHARGED_STATES: readonly BookingStatus[] = [
  'paid_held',
  'in_progress',
  'delivered',
  'released',
];

const ChargeRefundedSchema = z.object({
  id: z.string().startsWith('ch_'),
  payment_intent: z.string().nullable().optional(),
  amount: z.number().int().nonnegative(),
  amount_refunded: z.number().int().nonnegative(),
  currency: z.string().length(3),
  refunds: z
    .object({
      data: z.array(
        z.object({
          id: z.string().startsWith('re_'),
          amount: z.number().int().nonnegative(),
          status: z.string().nullable().optional(),
        }),
      ),
    })
    .nullable()
    .optional(),
});

const TransferReversedSchema = z.object({
  id: z.string().startsWith('tr_'),
  amount: z.number().int().nonnegative(),
  amount_reversed: z.number().int().nonnegative(),
  currency: z.string().length(3),
  reversals: z
    .object({
      data: z.array(
        z.object({
          id: z.string().startsWith('trr_'),
          amount: z.number().int().nonnegative(),
        }),
      ),
    })
    .nullable()
    .optional(),
});

const DisputeSchema = z.object({
  id: z.string().startsWith('dp_'),
  charge: z.string().startsWith('ch_'),
  payment_intent: z.string().nullable().optional(),
  amount: z.number().int().nonnegative(),
  currency: z.string().length(3),
  reason: z.string().max(100),
  status: z.string(),
});

type StripeDispute = z.infer<typeof DisputeSchema>;

// Stripe's `prevented` and `warning_closed` end without the funds leaving
// the platform, which for the booking is the same as a won dispute.
const STRIPE_DISPUTE_OUTCOME: Record<string, 'won' | 'lost' | undefined> = {
  won: 'won',
  warning_closed: 'won',
  prevented: 'won',
  lost: 'lost',
};

interface LockedBooking {
  id: string;
  status: BookingStatus;
  clientId: string;
  chargeId: string | null;
  transferId: string | null;
  deliveredAt: Date | null;
  releasedAt: Date | null;
  currency: string;
}

// Dispute has no stripeDisputeId column yet, so the Stripe id is carried at
// the front of `reason` and looked up by prefix.
export function stripeDisputeReason(disputeId: string, stripeReason: string): string {
  return `stripe_dispute:${disputeId}:${stripeReason}`;
}

function disputeReasonPrefix(disputeId: string): string {
  return `stripe_dispute:${disputeId}:`;
}

@Injectable()
export class BookingMoneyEventsService {
  constructor(
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
    @Inject(Logger) private readonly logger: Logger,
  ) {}

  async onChargeRefunded(
    tx: Prisma.TransactionClient,
    event: GatewayEvent,
  ): Promise<MoneyEventOutcome> {
    const charge = ChargeRefundedSchema.parse(event.data.object);
    const ids = { stripeEventId: event.id, chargeId: charge.id };
    const booking = await this.lockBookingByCharge(tx, charge.id, charge.payment_intent ?? null);
    if (!booking || booking.status === 'pending_payment') {
      this.logger.warn(ids, 'stripe webhook: no paid booking for this refunded charge yet');
      return DEFERRED;
    }
    const logIds = { ...ids, bookingId: booking.id };
    if (charge.currency.toUpperCase() !== booking.currency) {
      this.logger.error(logIds, 'stripe webhook: refunded charge currency differs from the quote');
      return DEFERRED;
    }

    for (const refund of charge.refunds?.data ?? []) {
      if (refund.status === 'failed' || refund.status === 'canceled') {
        continue;
      }
      const recorded = await tx.ledgerEntry.createMany({
        data: [
          {
            bookingId: booking.id,
            type: 'refund',
            amountCents: -refund.amount,
            currency: booking.currency,
            stripeObjectId: refund.id,
          },
        ],
        skipDuplicates: true,
      });
      if (recorded.count > 0) {
        await this.auditSystem(tx, booking, 'booking.refund_recorded', {
          refundId: refund.id,
          amountCents: refund.amount,
          chargeId: charge.id,
          stripeEventId: event.id,
        });
      }
    }

    const totals = await ledgerTotals(tx, booking.id);
    if (charge.amount_refunded > totals.refundedCents) {
      await this.auditSystem(tx, booking, 'booking.refund_unreconciled', {
        chargeId: charge.id,
        stripeAmountRefundedCents: charge.amount_refunded,
        ledgerRefundedCents: totals.refundedCents,
        stripeEventId: event.id,
      });
      this.logger.error(
        {
          ...logIds,
          stripeAmountRefundedCents: charge.amount_refunded,
          ledgerRefundedCents: totals.refundedCents,
        },
        'stripe webhook: Stripe reports more refunded than the ledger holds; reconcile the missing refunds by hand',
      );
    }

    const fullyRefunded = charge.amount > 0 && charge.amount_refunded >= charge.amount;
    if (
      fullyRefunded &&
      booking.chargeId === charge.id &&
      CHARGED_STATES.includes(booking.status)
    ) {
      if (booking.status === 'released' && reversibleCents(totals) > 0) {
        this.logger.error(
          { ...logIds, transferId: booking.transferId },
          'stripe webhook: released booking refunded in full without reversing its transfer; reverse it from the admin app',
        );
      }
      await transitionBooking(tx, {
        bookingId: booking.id,
        from: booking.status,
        to: 'refunded',
        actor: { type: 'system', id: null },
        audit: { chargeId: charge.id, stripeEventId: event.id },
      });
    }
    return PROCESSED;
  }

  async onTransferReversed(
    tx: Prisma.TransactionClient,
    event: GatewayEvent,
  ): Promise<MoneyEventOutcome> {
    const transfer = TransferReversedSchema.parse(event.data.object);
    const ids = { stripeEventId: event.id, transferId: transfer.id };
    const booking = await this.lockBookingByTransfer(tx, transfer.id);
    if (!booking) {
      this.logger.warn(ids, 'stripe webhook: no booking for this reversed transfer yet');
      return DEFERRED;
    }
    const logIds = { ...ids, bookingId: booking.id };
    if (transfer.currency.toUpperCase() !== booking.currency) {
      this.logger.error(
        logIds,
        'stripe webhook: reversed transfer currency differs from the quote',
      );
      return DEFERRED;
    }

    for (const reversal of transfer.reversals?.data ?? []) {
      const recorded = await tx.ledgerEntry.createMany({
        data: [
          {
            bookingId: booking.id,
            type: 'reversal',
            amountCents: reversal.amount,
            currency: booking.currency,
            stripeObjectId: reversal.id,
          },
        ],
        skipDuplicates: true,
      });
      if (recorded.count > 0) {
        await this.auditSystem(tx, booking, 'booking.reversal_recorded', {
          reversalId: reversal.id,
          transferId: transfer.id,
          amountCents: reversal.amount,
          stripeEventId: event.id,
        });
      }
    }

    const totals = await ledgerTotals(tx, booking.id);
    if (transfer.amount_reversed > totals.reversedCents) {
      await this.auditSystem(tx, booking, 'booking.reversal_unreconciled', {
        transferId: transfer.id,
        stripeAmountReversedCents: transfer.amount_reversed,
        ledgerReversedCents: totals.reversedCents,
        stripeEventId: event.id,
      });
      this.logger.error(
        {
          ...logIds,
          stripeAmountReversedCents: transfer.amount_reversed,
          ledgerReversedCents: totals.reversedCents,
        },
        'stripe webhook: Stripe reports more reversed than the ledger holds; reconcile the missing reversals by hand',
      );
    }
    return PROCESSED;
  }

  async onDisputeCreated(
    tx: Prisma.TransactionClient,
    event: GatewayEvent,
  ): Promise<MoneyEventOutcome> {
    const dispute = DisputeSchema.parse(event.data.object);
    const booking = await this.lockBookingByCharge(
      tx,
      dispute.charge,
      dispute.payment_intent ?? null,
    );
    if (!booking || booking.status === 'pending_payment') {
      this.logger.warn(
        { stripeEventId: event.id, disputeId: dispute.id, chargeId: dispute.charge },
        'stripe webhook: no paid booking for this disputed charge yet',
      );
      return DEFERRED;
    }
    const existing = await this.findDispute(tx, booking.id, dispute.id);
    if (existing) {
      return PROCESSED;
    }
    const opened = await this.openDispute(tx, event, booking, dispute);
    return { status: 'processed', afterCommit: opened };
  }

  // A closed event that arrives before its created event opens the dispute
  // itself, so the created event finds it and changes nothing.
  async onDisputeClosed(
    tx: Prisma.TransactionClient,
    event: GatewayEvent,
  ): Promise<MoneyEventOutcome> {
    const dispute = DisputeSchema.parse(event.data.object);
    const booking = await this.lockBookingByCharge(
      tx,
      dispute.charge,
      dispute.payment_intent ?? null,
    );
    const ids = { stripeEventId: event.id, disputeId: dispute.id, chargeId: dispute.charge };
    if (!booking || booking.status === 'pending_payment') {
      this.logger.warn(ids, 'stripe webhook: no paid booking for this disputed charge yet');
      return DEFERRED;
    }
    const logIds = { ...ids, bookingId: booking.id };
    const outcome = STRIPE_DISPUTE_OUTCOME[dispute.status];
    if (!outcome) {
      this.logger.error(
        { ...logIds, disputeStatus: dispute.status },
        'stripe webhook: closed dispute has a status that is neither won nor lost; resolve it by hand',
      );
      return PROCESSED;
    }

    let afterCommit = NOTHING_AFTER_COMMIT;
    let record = await this.findDispute(tx, booking.id, dispute.id);
    if (!record) {
      afterCommit = await this.openDispute(tx, event, booking, dispute);
      record = await this.findDispute(tx, booking.id, dispute.id);
      if (!record) {
        throw new Error(`stripe webhook: dispute ${dispute.id} vanished right after it was opened`);
      }
    }
    if (record.status !== 'open') {
      return { status: 'processed', afterCommit };
    }

    await tx.dispute.update({
      where: { id: record.id },
      data: {
        status: outcome,
        resolution: `stripe:${dispute.status}`,
        amountRefundedCents: outcome === 'lost' ? dispute.amount : 0,
      },
    });
    const current = await tx.booking.findUniqueOrThrow({
      where: { id: booking.id },
      select: { status: true },
    });
    await this.auditSystem(
      tx,
      { ...booking, status: current.status },
      `booking.dispute_${outcome}`,
      {
        disputeId: record.id,
        stripeDisputeId: dispute.id,
        amountCents: dispute.amount,
        stripeEventId: event.id,
      },
    );

    if (outcome === 'lost') {
      this.logger.warn(
        { ...logIds, amountCents: dispute.amount, status: current.status },
        'stripe webhook: dispute lost, booking stays disputed for an admin to settle',
      );
      return { status: 'processed', afterCommit };
    }

    const stillOpen = await tx.dispute.count({
      where: { bookingId: booking.id, status: 'open' },
    });
    if (current.status === 'disputed' && stillOpen === 0) {
      const restored = await this.priorStatus(tx, booking);
      await transitionBooking(tx, {
        bookingId: booking.id,
        from: 'disputed',
        to: restored,
        actor: { type: 'system', id: null },
        audit: { stripeDisputeId: dispute.id, stripeEventId: event.id },
      });
    }
    return { status: 'processed', afterCommit };
  }

  private async openDispute(
    tx: Prisma.TransactionClient,
    event: GatewayEvent,
    booking: LockedBooking,
    dispute: StripeDispute,
  ): Promise<AfterCommit> {
    const logIds = {
      stripeEventId: event.id,
      disputeId: dispute.id,
      chargeId: dispute.charge,
      bookingId: booking.id,
    };
    if (CHARGED_STATES.includes(booking.status)) {
      await transitionBooking(tx, {
        bookingId: booking.id,
        from: booking.status,
        to: 'disputed',
        actor: { type: 'system', id: null },
        audit: { stripeDisputeId: dispute.id, chargeId: dispute.charge, stripeEventId: event.id },
      });
    } else if (booking.status !== 'disputed') {
      this.logger.error(
        { ...logIds, status: booking.status },
        'stripe webhook: dispute opened on a booking that is already settled; resolve it by hand',
      );
    }
    const created = await tx.dispute.create({
      data: {
        bookingId: booking.id,
        openedById: booking.clientId,
        reason: stripeDisputeReason(dispute.id, dispute.reason),
      },
      select: { id: true },
    });
    await this.auditSystem(tx, booking, 'dispute.opened', {
      disputeId: created.id,
      stripeDisputeId: dispute.id,
      chargeId: dispute.charge,
      amountCents: dispute.amount,
      stripeEventId: event.id,
    });

    const financeAdmins = await tx.adminPermissionGrant.findMany({
      where: { permission: 'finance' },
      select: { userId: true },
    });
    const notificationIds: string[] = [];
    for (const grant of financeAdmins) {
      notificationIds.push(
        await this.notifications.createNotification(tx, grant.userId, 'dispute_opened', {
          total: { amountCents: dispute.amount, currency: dispute.currency.toUpperCase() },
        }),
      );
    }
    if (financeAdmins.length === 0) {
      this.logger.error(logIds, 'stripe webhook: dispute opened but no finance admin to notify');
    }
    return async () => {
      this.logger.warn(
        { ...logIds, amountCents: dispute.amount, notified: notificationIds.length },
        'stripe webhook: dispute opened, booking frozen',
      );
      for (const notificationId of notificationIds) {
        await this.notifications.enqueue(notificationId);
      }
    };
  }

  private findDispute(
    tx: Prisma.TransactionClient,
    bookingId: string,
    disputeId: string,
  ): Promise<{ id: string; status: 'open' | 'won' | 'lost' } | null> {
    return tx.dispute.findFirst({
      where: { bookingId, reason: { startsWith: disputeReasonPrefix(disputeId) } },
      select: { id: true, status: true },
    });
  }

  // The state the booking was frozen in is the `before` of the latest
  // `booking.disputed` audit row; the timestamps are the fallback if that row
  // is missing or unreadable.
  private async priorStatus(
    tx: Prisma.TransactionClient,
    booking: LockedBooking,
  ): Promise<BookingStatus> {
    const frozen = await tx.auditLog.findFirst({
      where: { targetType: 'Booking', targetId: booking.id, action: 'booking.disputed' },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      select: { before: true },
    });
    const parsed = z
      .object({ status: z.enum(['paid_held', 'in_progress', 'delivered', 'released']) })
      .safeParse(frozen?.before);
    if (parsed.success) {
      return parsed.data.status;
    }
    this.logger.warn(
      { bookingId: booking.id },
      'stripe webhook: no readable pre-dispute status in the audit log, deriving it from timestamps',
    );
    if (booking.releasedAt) {
      return 'released';
    }
    return booking.deliveredAt ? 'delivered' : 'paid_held';
  }

  private async lockBookingByCharge(
    tx: Prisma.TransactionClient,
    chargeId: string,
    paymentIntentId: string | null,
  ): Promise<LockedBooking | null> {
    const byCharge = await tx.booking.findFirst({
      where: { chargeId },
      select: { id: true },
    });
    const byLedger = byCharge
      ? null
      : await tx.ledgerEntry.findFirst({
          where: { type: 'charge', stripeObjectId: chargeId },
          select: { bookingId: true },
        });
    const byIntent =
      byCharge || byLedger || !paymentIntentId
        ? null
        : await tx.booking.findUnique({ where: { paymentIntentId }, select: { id: true } });
    const bookingId = byCharge?.id ?? byLedger?.bookingId ?? byIntent?.id;
    return bookingId ? this.lockBooking(tx, bookingId) : null;
  }

  private async lockBookingByTransfer(
    tx: Prisma.TransactionClient,
    transferId: string,
  ): Promise<LockedBooking | null> {
    const byLedger = await tx.ledgerEntry.findFirst({
      where: { type: 'transfer', stripeObjectId: transferId },
      select: { bookingId: true },
    });
    const byBooking = byLedger
      ? null
      : await tx.booking.findFirst({ where: { transferId }, select: { id: true } });
    const bookingId = byLedger?.bookingId ?? byBooking?.id;
    return bookingId ? this.lockBooking(tx, bookingId) : null;
  }

  private async lockBooking(
    tx: Prisma.TransactionClient,
    bookingId: string,
  ): Promise<LockedBooking | null> {
    await tx.$queryRaw`SELECT id FROM "Booking" WHERE id = ${bookingId} FOR UPDATE`;
    const row = await tx.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        status: true,
        clientId: true,
        chargeId: true,
        transferId: true,
        deliveredAt: true,
        releasedAt: true,
        quote: { select: { currency: true } },
      },
    });
    if (!row) {
      return null;
    }
    const { quote, ...booking } = row;
    return { ...booking, currency: quote.currency };
  }

  private async auditSystem(
    tx: Prisma.TransactionClient,
    booking: Pick<LockedBooking, 'id' | 'status'>,
    action: string,
    after: Record<string, string | number | null>,
  ): Promise<void> {
    await tx.auditLog.create({
      data: {
        actorType: 'system',
        actorId: null,
        action,
        targetType: 'Booking',
        targetId: booking.id,
        before: { status: booking.status },
        after: { status: booking.status, ...after },
        ip: null,
      },
    });
  }
}
