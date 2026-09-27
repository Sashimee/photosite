import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@photoo/db';
import { Logger } from 'nestjs-pino';
import { z } from 'zod';
import { APP_CONFIG, type Env } from '../../config/env.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { IllegalBookingTransitionError, transitionBooking } from '../bookings/booking-state.js';
import { BookingMoneyEventsService } from './booking-money-events.service.js';
import { type AfterCommit, StripeConnectService } from './stripe-connect.service.js';
import {
  type ConnectedAccount,
  type GatewayEvent,
  isLiveSecretKey,
  parseConnectedAccount,
  parseGatewayEvent,
  type Refund,
  STRIPE_GATEWAY,
  type StripeGateway,
} from './stripe/stripe-gateway.js';

const NOTHING_AFTER_COMMIT: AfterCommit = () => Promise.resolve();

interface Outcome {
  // `deferred` leaves StripeEvent.processedAt null so the stuck-event sweep
  // retries it, e.g. when the event reached us before the booking it refers to.
  // `settling` also leaves it null; its afterCommit makes a Stripe call and
  // marks the event processed only once that call's result is recorded.
  // `ignored` leaves it null too, so a type handled later can still be replayed.
  status: 'processed' | 'deferred' | 'settling' | 'ignored';
  afterCommit: AfterCommit;
}

export const HANDLED_EVENT_TYPES = [
  'payment_intent.succeeded',
  'payment_intent.payment_failed',
  'account.updated',
  'charge.refunded',
  'transfer.reversed',
  'charge.dispute.created',
  'charge.dispute.closed',
] as const;

export type ReprocessResult = 'processed' | 'deferred' | 'skipped';

// State read from Stripe before the transaction opens, so no network call
// holds a database transaction. `account` is null when the event is not an
// account.updated or the fetch failed; `chargeRefunds` likewise for a
// platform charge.refunded.
interface Prefetched {
  account: ConnectedAccount | null;
  chargeRefunds: Refund[] | null;
}

const NOTHING_PREFETCHED: Prefetched = { account: null, chargeRefunds: null };

const RefundedChargeIdSchema = z.object({ id: z.string().startsWith('ch_') });

const PROCESSED: Outcome = { status: 'processed', afterCommit: NOTHING_AFTER_COMMIT };
const DEFERRED: Outcome = { status: 'deferred', afterCommit: NOTHING_AFTER_COMMIT };
const IGNORED: Outcome = { status: 'ignored', afterCommit: NOTHING_AFTER_COMMIT };

const PaymentIntentObjectSchema = z.object({
  id: z.string().startsWith('pi_'),
  amount: z.number().int(),
  currency: z.string().length(3),
  latest_charge: z.string().nullable().optional(),
  last_payment_error: z
    .object({
      code: z.string().nullable().optional(),
      decline_code: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
});

type PaymentIntentObject = z.infer<typeof PaymentIntentObjectSchema>;

function toStoredPayload(event: GatewayEvent): Prisma.InputJsonObject {
  return {
    id: event.id,
    type: event.type,
    livemode: event.livemode,
    ...(event.account === undefined ? {} : { account: event.account }),
    data: event.data as Prisma.InputJsonObject,
  };
}

@Injectable()
export class StripeWebhookService {
  private readonly live: boolean;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(StripeConnectService) private readonly connect: StripeConnectService,
    @Inject(STRIPE_GATEWAY) private readonly gateway: StripeGateway,
    @Inject(APP_CONFIG) env: Env,
    @Inject(Logger) private readonly logger: Logger,
    @Inject(BookingMoneyEventsService) private readonly moneyEvents: BookingMoneyEventsService,
  ) {
    this.live = isLiveSecretKey(env.STRIPE_SECRET_KEY);
  }

  async receive(event: GatewayEvent): Promise<void> {
    if (event.livemode !== this.live) {
      this.logger.warn(
        { stripeEventId: event.id, type: event.type, livemode: event.livemode },
        'stripe webhook: event livemode does not match the configured key, ignoring',
      );
      return;
    }

    const prefetched = await this.prefetch(event);
    const afterCommit = await this.prisma.client.$transaction(async (tx) => {
      const inserted = await tx.stripeEvent.createMany({
        data: [{ id: event.id, type: event.type, payload: toStoredPayload(event) }],
        skipDuplicates: true,
      });
      if (inserted.count === 0) {
        const [stored] = await tx.$queryRaw<{ processedAt: Date | null }[]>`
          SELECT "processedAt" FROM "StripeEvent" WHERE id = ${event.id} FOR UPDATE`;
        if (stored?.processedAt) {
          this.logger.log(
            { stripeEventId: event.id, type: event.type },
            'stripe webhook: duplicate event, already processed',
          );
          return NOTHING_AFTER_COMMIT;
        }
      }
      return (await this.processLocked(tx, event, prefetched)).afterCommit;
    });
    await afterCommit();
  }

  // `skipped` covers an event that is gone, already processed or locked by
  // another instance; SKIP LOCKED lets several API instances sweep at once.
  async reprocess(eventId: string): Promise<ReprocessResult> {
    const pending = await this.prisma.client.stripeEvent.findFirst({
      where: { id: eventId, processedAt: null },
      select: { payload: true },
    });
    if (!pending) {
      return 'skipped';
    }
    const prefetched = await this.prefetch(parseGatewayEvent(pending.payload));
    const outcome = await this.prisma.client.$transaction(async (tx) => {
      const [stored] = await tx.$queryRaw<{ payload: unknown; processedAt: Date | null }[]>`
        SELECT payload, "processedAt" FROM "StripeEvent" WHERE id = ${eventId}
        FOR UPDATE SKIP LOCKED`;
      if (!stored || stored.processedAt) {
        return null;
      }
      return this.processLocked(tx, parseGatewayEvent(stored.payload), prefetched);
    });
    if (!outcome || outcome.status === 'ignored') {
      return 'skipped';
    }
    await outcome.afterCommit();
    return outcome.status === 'settling' ? 'processed' : outcome.status;
  }

  private async prefetch(event: GatewayEvent): Promise<Prefetched> {
    if (event.type === 'charge.refunded' && event.account === undefined) {
      return this.prefetchChargeRefunds(event);
    }
    if (event.type !== 'account.updated') {
      return NOTHING_PREFETCHED;
    }
    const accountId = parseConnectedAccount(event.data.object).id;
    try {
      return { ...NOTHING_PREFETCHED, account: await this.connect.fetchAccount(accountId) };
    } catch (error) {
      this.logger.error(
        {
          stripeEventId: event.id,
          stripeAccountId: accountId,
          error: error instanceof Error ? error.message : String(error),
        },
        'stripe webhook: could not re-read the connected account from Stripe',
      );
      return NOTHING_PREFETCHED;
    }
  }

  private async prefetchChargeRefunds(event: GatewayEvent): Promise<Prefetched> {
    const charge = RefundedChargeIdSchema.safeParse(event.data.object);
    if (!charge.success) {
      this.logger.error(
        { stripeEventId: event.id, type: event.type },
        'stripe webhook: charge.refunded payload has no charge id',
      );
      return NOTHING_PREFETCHED;
    }
    try {
      return {
        ...NOTHING_PREFETCHED,
        chargeRefunds: await this.gateway.listChargeRefunds(charge.data.id),
      };
    } catch (error) {
      this.logger.error(
        {
          stripeEventId: event.id,
          chargeId: charge.data.id,
          error: error instanceof Error ? error.message : String(error),
        },
        'stripe webhook: could not list the refunds of the charge from Stripe',
      );
      return NOTHING_PREFETCHED;
    }
  }

  private async processLocked(
    tx: Prisma.TransactionClient,
    event: GatewayEvent,
    prefetched: Prefetched,
  ): Promise<Outcome> {
    const outcome = await this.dispatch(tx, event, prefetched);
    if (outcome.status === 'deferred') {
      this.logger.warn(
        { stripeEventId: event.id, type: event.type },
        'stripe webhook: event deferred for the stuck-event sweep',
      );
      return DEFERRED;
    }
    if (outcome.status === 'processed') {
      await tx.stripeEvent.update({ where: { id: event.id }, data: { processedAt: new Date() } });
    }
    return outcome;
  }

  private async dispatch(
    tx: Prisma.TransactionClient,
    event: GatewayEvent,
    prefetched: Prefetched,
  ): Promise<Outcome> {
    switch (event.type) {
      case 'payment_intent.succeeded':
        return this.onPaymentIntentSucceeded(tx, event);
      case 'payment_intent.payment_failed':
        return this.onPaymentIntentFailed(tx, event);
      case 'account.updated':
        if (!prefetched.account) {
          return DEFERRED;
        }
        return {
          status: 'processed',
          afterCommit: await this.connect.applyAccountUpdated(tx, prefetched.account),
        };
      case 'charge.refunded':
        if (!this.fromPlatform(event)) {
          return PROCESSED;
        }
        if (!prefetched.chargeRefunds) {
          return DEFERRED;
        }
        return this.moneyEvents.onChargeRefunded(tx, event, prefetched.chargeRefunds);
      case 'transfer.reversed':
        return this.fromPlatform(event)
          ? this.moneyEvents.onTransferReversed(tx, event)
          : PROCESSED;
      case 'charge.dispute.created':
        return this.fromPlatform(event) ? this.moneyEvents.onDisputeCreated(tx, event) : PROCESSED;
      case 'charge.dispute.closed':
        return this.fromPlatform(event) ? this.moneyEvents.onDisputeClosed(tx, event) : PROCESSED;
      default:
        this.logger.log(
          { stripeEventId: event.id, type: event.type },
          'stripe webhook: event type not handled, recorded only',
        );
        return IGNORED;
    }
  }

  private fromPlatform(event: GatewayEvent): boolean {
    if (event.account === undefined) {
      return true;
    }
    this.logger.warn(
      { stripeEventId: event.id, type: event.type, stripeAccountId: event.account },
      'stripe webhook: money event from a connected account, ignoring',
    );
    return false;
  }

  private parsePaymentIntent(event: GatewayEvent): PaymentIntentObject | null {
    if (event.account !== undefined) {
      this.logger.warn(
        { stripeEventId: event.id, type: event.type, stripeAccountId: event.account },
        'stripe webhook: payment intent event from a connected account, ignoring',
      );
      return null;
    }
    return PaymentIntentObjectSchema.parse(event.data.object);
  }

  private async onPaymentIntentSucceeded(
    tx: Prisma.TransactionClient,
    event: GatewayEvent,
  ): Promise<Outcome> {
    const intent = this.parsePaymentIntent(event);
    if (!intent) {
      return PROCESSED;
    }
    const ids = { stripeEventId: event.id, paymentIntentId: intent.id };
    await tx.$queryRaw`SELECT id FROM "Booking" WHERE "paymentIntentId" = ${intent.id} FOR UPDATE`;
    const booking = await tx.booking.findUnique({
      where: { paymentIntentId: intent.id },
      include: { quote: true },
    });
    if (!booking) {
      this.logger.warn(ids, 'stripe webhook: no booking for this payment intent yet');
      return DEFERRED;
    }
    const logIds = { ...ids, bookingId: booking.id };
    const { quote } = booking;

    if (intent.amount !== quote.totalCents || intent.currency.toUpperCase() !== quote.currency) {
      this.logger.error(
        logIds,
        'stripe webhook: paid amount or currency differs from the quote; investigate before the booking can proceed',
      );
      return DEFERRED;
    }
    // The fee was checked against the shared helper when the booking and the
    // payment intent were created; the snapshot is what gets charged and
    // transferred, so only its internal consistency matters here.
    if (quote.platformFeeCents < 0 || quote.platformFeeCents > quote.subtotalCents) {
      this.logger.error(
        { ...logIds, quoteId: quote.id },
        'stripe webhook: quote platform fee is outside 0..subtotal; investigate before the booking can proceed',
      );
      return DEFERRED;
    }
    const chargeId = intent.latest_charge;
    if (!chargeId) {
      this.logger.error(logIds, 'stripe webhook: succeeded payment intent carries no charge');
      return DEFERRED;
    }

    try {
      await transitionBooking(tx, {
        bookingId: booking.id,
        from: booking.status,
        to: 'paid_held',
        actor: { type: 'system', id: null },
        data: { chargeId },
        audit: { paymentIntentId: intent.id, chargeId, stripeEventId: event.id },
      });
    } catch (error) {
      if (error instanceof IllegalBookingTransitionError) {
        if (booking.chargeId === chargeId) {
          this.logger.warn(
            { ...logIds, chargeId, status: booking.status },
            'stripe webhook: booking already paid for this charge',
          );
          return PROCESSED;
        }
        return this.refundLatePayment(tx, event, {
          bookingId: booking.id,
          status: booking.status,
          paymentIntentId: intent.id,
          chargeId,
          totalCents: quote.totalCents,
          currency: quote.currency,
        });
      }
      throw error;
    }

    await tx.ledgerEntry.create({
      data: {
        bookingId: booking.id,
        type: 'charge',
        amountCents: quote.totalCents,
        currency: quote.currency,
        stripeObjectId: chargeId,
      },
    });
    return {
      status: 'processed',
      afterCommit: () => {
        this.logger.log({ ...logIds, chargeId }, 'stripe webhook: booking paid and held');
        return Promise.resolve();
      },
    };
  }

  // A payment that lands after the booking was cancelled (or on a booking
  // already paid by another charge) is kept on the platform account and
  // refunded in full; the refund never touches a connected account.
  private async refundLatePayment(
    tx: Prisma.TransactionClient,
    event: GatewayEvent,
    late: {
      bookingId: string;
      status: string;
      paymentIntentId: string;
      chargeId: string;
      totalCents: number;
      currency: string;
    },
  ): Promise<Outcome> {
    const ids = {
      stripeEventId: event.id,
      bookingId: late.bookingId,
      paymentIntentId: late.paymentIntentId,
      chargeId: late.chargeId,
    };
    const charge = await tx.ledgerEntry.createMany({
      data: [
        {
          bookingId: late.bookingId,
          type: 'charge',
          amountCents: late.totalCents,
          currency: late.currency,
          stripeObjectId: late.chargeId,
        },
      ],
      skipDuplicates: true,
    });
    if (charge.count > 0) {
      await tx.auditLog.create({
        data: {
          actorType: 'system',
          actorId: null,
          action: 'booking.paid_after_terminal',
          targetType: 'Booking',
          targetId: late.bookingId,
          before: { status: late.status },
          after: {
            status: late.status,
            paymentIntentId: late.paymentIntentId,
            chargeId: late.chargeId,
            stripeEventId: event.id,
          },
          ip: null,
        },
      });
    }
    this.logger.error(
      { ...ids, status: late.status },
      'stripe webhook: payment succeeded for a booking that cannot become paid_held; refunding it in full',
    );
    return {
      status: 'settling',
      afterCommit: async () => {
        const refund = await this.gateway.createRefund({
          paymentIntentId: late.paymentIntentId,
          metadata: { bookingId: late.bookingId, reason: 'late_payment' },
          idempotencyKey: `refund_${late.bookingId}_late`,
        });
        await this.prisma.client.$transaction(async (settle) => {
          const recorded = await settle.ledgerEntry.createMany({
            data: [
              {
                bookingId: late.bookingId,
                type: 'refund',
                amountCents: -refund.amountCents,
                currency: late.currency,
                stripeObjectId: refund.id,
              },
            ],
            skipDuplicates: true,
          });
          if (recorded.count > 0) {
            await settle.auditLog.create({
              data: {
                actorType: 'system',
                actorId: null,
                action: 'booking.late_payment_refunded',
                targetType: 'Booking',
                targetId: late.bookingId,
                before: { status: late.status },
                after: {
                  status: late.status,
                  refundId: refund.id,
                  amountCents: refund.amountCents,
                },
                ip: null,
              },
            });
          }
          await settle.stripeEvent.update({
            where: { id: event.id },
            data: { processedAt: new Date() },
          });
        });
        this.logger.log({ ...ids, refundId: refund.id }, 'stripe webhook: late payment refunded');
      },
    };
  }

  private async onPaymentIntentFailed(
    tx: Prisma.TransactionClient,
    event: GatewayEvent,
  ): Promise<Outcome> {
    const intent = this.parsePaymentIntent(event);
    if (!intent) {
      return PROCESSED;
    }
    const ids = { stripeEventId: event.id, paymentIntentId: intent.id };
    const booking = await tx.booking.findUnique({
      where: { paymentIntentId: intent.id },
      select: { id: true, status: true },
    });
    if (!booking) {
      this.logger.warn(ids, 'stripe webhook: no booking for this payment intent yet');
      return DEFERRED;
    }
    const failure = {
      paymentIntentId: intent.id,
      stripeEventId: event.id,
      errorCode: intent.last_payment_error?.code ?? null,
      declineCode: intent.last_payment_error?.decline_code ?? null,
    };
    await tx.auditLog.create({
      data: {
        actorType: 'system',
        actorId: null,
        action: 'booking.payment_failed',
        targetType: 'Booking',
        targetId: booking.id,
        before: { status: booking.status },
        after: { status: booking.status, ...failure },
        ip: null,
      },
    });
    return {
      status: 'processed',
      afterCommit: () => {
        this.logger.log(
          { ...failure, bookingId: booking.id },
          'stripe webhook: payment attempt failed',
        );
        return Promise.resolve();
      },
    };
  }
}
