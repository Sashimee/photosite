import { HttpException, Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@photoo/db';
import type { BookingStatus, CreateRefundResponseSchema } from '@photoo/shared';
import { Logger } from 'nestjs-pino';
import type { z } from 'zod';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AdminAuditService } from '../admin/admin-audit.service.js';
import { BOOKING_INCLUDE, toBookingDtos } from '../bookings/booking-dto.js';
import { transitionBooking } from '../bookings/booking-state.js';
import { assertSupportedCurrency } from '../bookings/create-booking.js';
import { AdminBookingsService, type AdminBookingDto } from './admin-bookings.service.js';
import { ledgerTotals, reversibleCents } from './booking-ledger.js';
import { BookingMoneyLockService } from './booking-money-lock.service.js';
import {
  STRIPE_GATEWAY,
  type Refund,
  type StripeGateway,
  type TransferReversal,
} from './stripe/stripe-gateway.js';

const REFUND_TRANSACTION_TIMEOUT_MS = 15_000;

const REFUNDABLE_BEFORE_RELEASE: readonly BookingStatus[] = [
  'paid_held',
  'in_progress',
  'delivered',
];

type ClientRefundDto = z.infer<typeof CreateRefundResponseSchema>;

interface Actor {
  id: string;
}

interface RefundInput {
  amountCents?: number | undefined;
  reason: string;
}

interface ClientRefundPlan {
  bookingId: string;
  paymentIntentId: string;
  amountCents: number;
  currency: string;
  totalCents: number;
  idempotencyKey: string;
}

interface AdminRefundPlan {
  bookingId: string;
  paymentIntentId: string;
  transferId: string;
  amountCents: number;
  currency: string;
  totalCents: number;
  refundKey: string;
  reversalPending: boolean;
}

interface ReversalPlan {
  bookingId: string;
  transferId: string;
  amountCents: number;
  currency: string;
  idempotencyKey: string;
}

export function refundIdempotencyKey(bookingId: string, n: number): string {
  return `refund_${bookingId}_${String(n)}`;
}

export function refundReversalIdempotencyKey(refundKey: string): string {
  return `${refundKey}_reversal`;
}

export function transferReversalIdempotencyKey(bookingId: string, n: number): string {
  return `booking_${bookingId}_reversal_${String(n)}`;
}

function notFound(): HttpException {
  return new HttpException({ code: 'NOT_FOUND', message: 'Booking not found' }, 404);
}

function conflict(message: string): HttpException {
  return new HttpException({ code: 'CONFLICT', message }, 409);
}

function unprocessable(message: string): HttpException {
  return new HttpException({ code: 'UNPROCESSABLE_ENTITY', message }, 422);
}

async function lockBooking(tx: Prisma.TransactionClient, bookingId: string): Promise<void> {
  const [locked] = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "Booking" WHERE id = ${bookingId} FOR UPDATE`;
  if (!locked) {
    throw notFound();
  }
}

function pendingReversalAmount(after: Prisma.JsonValue, refundKey: string): number | null {
  if (typeof after !== 'object' || after === null || Array.isArray(after)) {
    return null;
  }
  const { refundKey: key, amountCents } = after;
  return key === refundKey && typeof amountCents === 'number' ? amountCents : null;
}

// Refunds move money out of the platform balance only. Before release that is
// all a refund needs (docs/PAYMENTS.md: it never touches the connected
// account); after release the same amount is first reversed from the
// photographer's transfer. Each Stripe call runs between two short
// transactions, keyed so a retried request replays instead of paying twice.
@Injectable()
export class BookingRefundService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(STRIPE_GATEWAY) private readonly gateway: StripeGateway,
    @Inject(AdminAuditService) private readonly adminAudit: AdminAuditService,
    @Inject(AdminBookingsService) private readonly adminBookings: AdminBookingsService,
    @Inject(BookingMoneyLockService) private readonly moneyLock: BookingMoneyLockService,
    @Inject(Logger) private readonly logger: Logger,
  ) {}

  refundAsClient(
    user: Actor,
    bookingId: string,
    input: RefundInput,
    ip: string | null,
  ): Promise<ClientRefundDto> {
    return this.underMoneyLock(bookingId, () => this.clientRefund(user, bookingId, input, ip));
  }

  refundAsAdmin(
    admin: Actor,
    bookingId: string,
    input: { amountCents: number; reason: string },
    ip: string | null,
  ): Promise<AdminBookingDto> {
    return this.underMoneyLock(bookingId, () => this.adminRefund(admin, bookingId, input, ip));
  }

  reverseTransferAsAdmin(
    admin: Actor,
    bookingId: string,
    input: { reason: string },
    ip: string | null,
  ): Promise<AdminBookingDto> {
    return this.underMoneyLock(bookingId, () =>
      this.adminTransferReversal(admin, bookingId, input, ip),
    );
  }

  private async underMoneyLock<T>(bookingId: string, fn: () => Promise<T>): Promise<T> {
    const result = await this.moneyLock.tryRun(bookingId, fn);
    if (!result.acquired) {
      this.logger.warn({ bookingId }, 'booking refund: refused, booking money lock is held');
      throw conflict('Another refund or release is in progress for this booking; retry shortly');
    }
    return result.value;
  }

  private async clientRefund(
    user: Actor,
    bookingId: string,
    input: RefundInput,
    ip: string | null,
  ): Promise<ClientRefundDto> {
    const plan = await this.planClientRefund(user, bookingId, input);
    const refund = await this.gateway.createRefund({
      paymentIntentId: plan.paymentIntentId,
      amountCents: plan.amountCents,
      metadata: { bookingId: plan.bookingId },
      idempotencyKey: plan.idempotencyKey,
    });
    this.assertRefundMatches(plan.bookingId, refund, plan.amountCents);
    const refundedCents = await this.prisma.client.$transaction(
      async (tx) => {
        await lockBooking(tx, plan.bookingId);
        await this.writeRefundRow(tx, plan.bookingId, refund, plan.currency);
        const totals = await ledgerTotals(tx, plan.bookingId);
        const booking = await tx.booking.findUniqueOrThrow({
          where: { id: plan.bookingId },
          select: { status: true },
        });
        const audit = {
          refundId: refund.id,
          amountCents: refund.amountCents,
          reason: input.reason,
        };
        if (
          totals.refundedCents >= plan.totalCents &&
          REFUNDABLE_BEFORE_RELEASE.includes(booking.status)
        ) {
          await transitionBooking(tx, {
            bookingId: plan.bookingId,
            from: booking.status,
            to: 'refunded',
            actor: { type: 'user', id: user.id },
            ip,
            audit,
          });
        } else {
          await tx.auditLog.create({
            data: {
              actorType: 'user',
              actorId: user.id,
              action: 'booking.refund_partial',
              targetType: 'Booking',
              targetId: plan.bookingId,
              before: { status: booking.status },
              after: { ...audit, refundedCents: totals.refundedCents },
              ip,
            },
          });
        }
        return totals.refundedCents;
      },
      { timeout: REFUND_TRANSACTION_TIMEOUT_MS },
    );
    this.logger.log(
      { bookingId: plan.bookingId, refundId: refund.id, paymentIntentId: plan.paymentIntentId },
      'booking refund: client refund recorded',
    );

    const row = await this.prisma.client.booking.findUniqueOrThrow({
      where: { id: plan.bookingId },
      include: BOOKING_INCLUDE,
    });
    const [booking] = await toBookingDtos(this.prisma.client, [row]);
    if (!booking) {
      throw new Error(`booking refund: booking ${plan.bookingId} vanished after its refund`);
    }
    return {
      status: refundedCents >= plan.totalCents ? 'refunded' : 'partially_refunded',
      amount: { amountCents: refund.amountCents, currency: plan.currency },
      refundedTotal: { amountCents: refundedCents, currency: plan.currency },
      booking,
    };
  }

  private planClientRefund(
    user: Actor,
    bookingId: string,
    input: RefundInput,
  ): Promise<ClientRefundPlan> {
    return this.prisma.client.$transaction(
      async (tx) => {
        await lockBooking(tx, bookingId);
        const booking = await tx.booking.findUniqueOrThrow({
          where: { id: bookingId },
          include: { quote: true, photographer: { select: { userId: true } } },
        });
        if (booking.clientId !== user.id && booking.photographer.userId !== user.id) {
          throw notFound();
        }
        if (booking.clientId !== user.id) {
          throw new HttpException(
            { code: 'FORBIDDEN', message: 'Only the client can request a refund' },
            403,
          );
        }
        if (!REFUNDABLE_BEFORE_RELEASE.includes(booking.status) || booking.transferId !== null) {
          throw conflict(
            `Booking is ${booking.status}; a client refund is only possible before release`,
          );
        }
        const openDisputes = await tx.dispute.count({
          where: { bookingId, status: 'open' },
        });
        if (openDisputes > 0) {
          throw conflict('Booking has an open dispute; refunds wait until it is resolved');
        }
        if (booking.paymentIntentId === null || booking.chargeId === null) {
          throw conflict('Booking payment has not settled yet; retry once it has');
        }

        const { quote } = booking;
        assertSupportedCurrency(quote.currency);
        const totals = await ledgerTotals(tx, bookingId);
        const remaining = quote.totalCents - totals.refundedCents;
        if (remaining <= 0) {
          throw unprocessable('Booking has already been refunded in full');
        }
        const amountCents = input.amountCents ?? remaining;
        if (amountCents > remaining) {
          throw unprocessable(
            `Refund of ${String(amountCents)} exceeds the ${String(remaining)} still refundable`,
          );
        }
        // Release transfers what is left minus the fee, so a partial refund
        // must leave more than the fee behind or release would have nothing to pay.
        if (amountCents < remaining && remaining - amountCents <= quote.platformFeeCents) {
          throw unprocessable(
            `A partial refund must leave more than the ${String(quote.platformFeeCents)} platform fee; refund the full ${String(remaining)} instead`,
          );
        }
        return {
          bookingId,
          paymentIntentId: booking.paymentIntentId,
          amountCents,
          currency: quote.currency,
          totalCents: quote.totalCents,
          idempotencyKey: refundIdempotencyKey(bookingId, totals.refundCount),
        } satisfies ClientRefundPlan;
      },
      { timeout: REFUND_TRANSACTION_TIMEOUT_MS },
    );
  }

  private async adminRefund(
    admin: Actor,
    bookingId: string,
    input: { amountCents: number; reason: string },
    ip: string | null,
  ): Promise<AdminBookingDto> {
    const plan = await this.planAdminRefund(bookingId, input.amountCents);
    if (!plan.reversalPending) {
      const reversal = await this.gateway.reverseTransfer({
        transferId: plan.transferId,
        amountCents: plan.amountCents,
        metadata: { bookingId },
        idempotencyKey: refundReversalIdempotencyKey(plan.refundKey),
      });
      this.assertReversalMatches(bookingId, reversal, plan.amountCents);
      await this.prisma.client.$transaction(
        async (tx) => {
          await lockBooking(tx, bookingId);
          await this.writeReversalRow(tx, bookingId, reversal, plan.currency);
          await this.adminAudit.record(tx, {
            actorId: admin.id,
            action: 'booking.refund_reversal',
            targetType: 'Booking',
            targetId: bookingId,
            after: {
              refundKey: plan.refundKey,
              reversalId: reversal.id,
              amountCents: reversal.amountCents,
              reason: input.reason,
            },
            ip,
          });
        },
        { timeout: REFUND_TRANSACTION_TIMEOUT_MS },
      );
      this.logger.log(
        { bookingId, transferId: plan.transferId, reversalId: reversal.id },
        'booking refund: transfer reversed ahead of an admin refund',
      );
    }

    const refund = await this.gateway.createRefund({
      paymentIntentId: plan.paymentIntentId,
      amountCents: plan.amountCents,
      metadata: { bookingId },
      idempotencyKey: plan.refundKey,
    });
    this.assertRefundMatches(bookingId, refund, plan.amountCents);
    await this.prisma.client.$transaction(
      async (tx) => {
        await lockBooking(tx, bookingId);
        await this.writeRefundRow(tx, bookingId, refund, plan.currency);
        const totals = await ledgerTotals(tx, bookingId);
        const booking = await tx.booking.findUniqueOrThrow({
          where: { id: bookingId },
          select: { status: true },
        });
        await this.adminAudit.record(tx, {
          actorId: admin.id,
          action: 'booking.admin_refund',
          targetType: 'Booking',
          targetId: bookingId,
          before: { status: booking.status },
          after: {
            refundId: refund.id,
            amountCents: refund.amountCents,
            refundedCents: totals.refundedCents,
            reason: input.reason,
          },
          ip,
        });
        const settled = reversibleCents(totals) <= 0 || totals.refundedCents >= plan.totalCents;
        if (settled && booking.status === 'released') {
          await transitionBooking(tx, {
            bookingId,
            from: 'released',
            to: 'refunded',
            actor: { type: 'admin', id: admin.id },
            ip,
            audit: { refundId: refund.id, amountCents: refund.amountCents },
          });
        }
      },
      { timeout: REFUND_TRANSACTION_TIMEOUT_MS },
    );
    this.logger.log(
      { bookingId, refundId: refund.id, paymentIntentId: plan.paymentIntentId },
      'booking refund: admin refund recorded',
    );
    return this.adminBookings.get(bookingId);
  }

  // A reversal recorded under the next refund key means an earlier attempt
  // reversed the transfer and then failed to refund; the retry resumes with
  // the refund instead of reversing a second time.
  private planAdminRefund(bookingId: string, amountCents: number): Promise<AdminRefundPlan> {
    return this.prisma.client.$transaction(
      async (tx) => {
        await lockBooking(tx, bookingId);
        const booking = await tx.booking.findUniqueOrThrow({
          where: { id: bookingId },
          include: { quote: true },
        });
        if (booking.status !== 'released') {
          throw conflict(
            `Booking is ${booking.status}; an admin refund is only possible after release`,
          );
        }
        if (
          booking.paymentIntentId === null ||
          booking.chargeId === null ||
          booking.transferId === null
        ) {
          throw new Error(
            `booking refund: released booking ${bookingId} lacks its payment intent, charge or transfer id; reconcile it before refunding`,
          );
        }
        const { quote } = booking;
        assertSupportedCurrency(quote.currency);
        const totals = await ledgerTotals(tx, bookingId);
        const refundKey = refundIdempotencyKey(bookingId, totals.refundCount);
        const reversals = await tx.auditLog.findMany({
          where: { action: 'booking.refund_reversal', targetType: 'Booking', targetId: bookingId },
          select: { after: true },
        });
        const pending = reversals
          .map((row) => pendingReversalAmount(row.after, refundKey))
          .find((amount) => amount !== null);
        if (pending !== undefined) {
          if (pending !== amountCents) {
            throw conflict(
              `A reversal of ${String(pending)} is waiting for its refund; retry the refund with that amount`,
            );
          }
        } else {
          const refundable = quote.totalCents - totals.refundedCents;
          if (amountCents > refundable) {
            throw unprocessable(
              `Refund of ${String(amountCents)} exceeds the ${String(refundable)} still refundable`,
            );
          }
          const reversible = reversibleCents(totals);
          if (amountCents > reversible) {
            throw unprocessable(
              `Refund of ${String(amountCents)} exceeds the ${String(reversible)} left on the photographer transfer`,
            );
          }
        }
        return {
          bookingId,
          paymentIntentId: booking.paymentIntentId,
          transferId: booking.transferId,
          amountCents,
          currency: quote.currency,
          totalCents: quote.totalCents,
          refundKey,
          reversalPending: pending !== undefined,
        } satisfies AdminRefundPlan;
      },
      { timeout: REFUND_TRANSACTION_TIMEOUT_MS },
    );
  }

  private async adminTransferReversal(
    admin: Actor,
    bookingId: string,
    input: { reason: string },
    ip: string | null,
  ): Promise<AdminBookingDto> {
    const plan = await this.planReversal(bookingId);
    const reversal = await this.gateway.reverseTransfer({
      transferId: plan.transferId,
      amountCents: plan.amountCents,
      metadata: { bookingId },
      idempotencyKey: plan.idempotencyKey,
    });
    this.assertReversalMatches(bookingId, reversal, plan.amountCents);
    await this.prisma.client.$transaction(
      async (tx) => {
        await lockBooking(tx, bookingId);
        await this.writeReversalRow(tx, bookingId, reversal, plan.currency);
        const booking = await tx.booking.findUniqueOrThrow({
          where: { id: bookingId },
          select: { status: true },
        });
        await this.adminAudit.record(tx, {
          actorId: admin.id,
          action: 'booking.transfer_reversed',
          targetType: 'Booking',
          targetId: bookingId,
          before: { status: booking.status },
          after: {
            reversalId: reversal.id,
            transferId: plan.transferId,
            amountCents: reversal.amountCents,
            reason: input.reason,
          },
          ip,
        });
      },
      { timeout: REFUND_TRANSACTION_TIMEOUT_MS },
    );
    this.logger.log(
      { bookingId, transferId: plan.transferId, reversalId: reversal.id },
      'booking refund: admin transfer reversal recorded',
    );
    return this.adminBookings.get(bookingId);
  }

  private planReversal(bookingId: string): Promise<ReversalPlan> {
    return this.prisma.client.$transaction(
      async (tx) => {
        await lockBooking(tx, bookingId);
        const booking = await tx.booking.findUniqueOrThrow({
          where: { id: bookingId },
          include: { quote: { select: { currency: true } } },
        });
        const afterRelease =
          booking.status === 'released' ||
          (booking.status === 'disputed' && booking.releasedAt !== null);
        if (!afterRelease || booking.transferId === null) {
          throw conflict(
            `Booking is ${booking.status}; a transfer can only be reversed after release`,
          );
        }
        const totals = await ledgerTotals(tx, bookingId);
        const reversible = reversibleCents(totals);
        if (reversible <= 0) {
          throw unprocessable('Nothing is left on the photographer transfer to reverse');
        }
        return {
          bookingId,
          transferId: booking.transferId,
          amountCents: reversible,
          currency: booking.quote.currency,
          idempotencyKey: transferReversalIdempotencyKey(bookingId, totals.reversalCount),
        } satisfies ReversalPlan;
      },
      { timeout: REFUND_TRANSACTION_TIMEOUT_MS },
    );
  }

  private async writeRefundRow(
    tx: Prisma.TransactionClient,
    bookingId: string,
    refund: Refund,
    currency: string,
  ): Promise<void> {
    await tx.ledgerEntry.createMany({
      data: [
        {
          bookingId,
          type: 'refund',
          amountCents: -refund.amountCents,
          currency,
          stripeObjectId: refund.id,
        },
      ],
      skipDuplicates: true,
    });
  }

  private async writeReversalRow(
    tx: Prisma.TransactionClient,
    bookingId: string,
    reversal: TransferReversal,
    currency: string,
  ): Promise<void> {
    await tx.ledgerEntry.createMany({
      data: [
        {
          bookingId,
          type: 'reversal',
          amountCents: reversal.amountCents,
          currency,
          stripeObjectId: reversal.id,
        },
      ],
      skipDuplicates: true,
    });
  }

  private assertRefundMatches(bookingId: string, refund: Refund, amountCents: number): void {
    if (
      refund.amountCents !== amountCents ||
      refund.status === 'failed' ||
      refund.status === 'canceled'
    ) {
      this.logger.error(
        { bookingId, refundId: refund.id, refundStatus: refund.status },
        'booking refund: Stripe refund does not match the requested amount or did not go through',
      );
      throw new Error(
        `booking refund: refund ${refund.id} for booking ${bookingId} is ${String(refund.status)} for ${String(refund.amountCents)} instead of ${String(amountCents)}; reconcile it by hand`,
      );
    }
  }

  private assertReversalMatches(
    bookingId: string,
    reversal: TransferReversal,
    amountCents: number,
  ): void {
    if (reversal.amountCents !== amountCents) {
      this.logger.error(
        { bookingId, reversalId: reversal.id, transferId: reversal.transferId },
        'booking refund: Stripe transfer reversal does not match the requested amount',
      );
      throw new Error(
        `booking refund: reversal ${reversal.id} for booking ${bookingId} is ${String(reversal.amountCents)} instead of ${String(amountCents)}; reconcile it by hand`,
      );
    }
  }
}
