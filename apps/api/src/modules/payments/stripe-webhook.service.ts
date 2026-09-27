import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@photoo/db';
import { Logger } from 'nestjs-pino';
import { z } from 'zod';
import { APP_CONFIG, type Env } from '../../config/env.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { IllegalBookingTransitionError, transitionBooking } from '../bookings/booking-state.js';
import { assertQuoteFeeMatches, PlatformFeeMismatchError } from '../bookings/create-booking.js';
import { type AfterCommit, StripeConnectService } from './stripe-connect.service.js';
import {
  type GatewayEvent,
  isLiveSecretKey,
  parseConnectedAccount,
  parseGatewayEvent,
} from './stripe/stripe-gateway.js';

const NOTHING_AFTER_COMMIT: AfterCommit = () => Promise.resolve();

interface Outcome {
  // `deferred` leaves StripeEvent.processedAt null so the stuck-event sweep
  // retries it, e.g. when the event reached us before the booking it refers to.
  status: 'processed' | 'deferred';
  afterCommit: AfterCommit;
}

export type ReprocessResult = Outcome['status'] | 'skipped';

const PROCESSED: Outcome = { status: 'processed', afterCommit: NOTHING_AFTER_COMMIT };
const DEFERRED: Outcome = { status: 'deferred', afterCommit: NOTHING_AFTER_COMMIT };

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
    @Inject(APP_CONFIG) env: Env,
    @Inject(Logger) private readonly logger: Logger,
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
      return (await this.processLocked(tx, event)).afterCommit;
    });
    await afterCommit();
  }

  // `skipped` covers an event that is gone, already processed or locked by
  // another instance; SKIP LOCKED lets several API instances sweep at once.
  async reprocess(eventId: string): Promise<ReprocessResult> {
    const outcome = await this.prisma.client.$transaction(async (tx) => {
      const [stored] = await tx.$queryRaw<{ payload: unknown; processedAt: Date | null }[]>`
        SELECT payload, "processedAt" FROM "StripeEvent" WHERE id = ${eventId}
        FOR UPDATE SKIP LOCKED`;
      if (!stored || stored.processedAt) {
        return null;
      }
      return this.processLocked(tx, parseGatewayEvent(stored.payload));
    });
    if (!outcome) {
      return 'skipped';
    }
    await outcome.afterCommit();
    return outcome.status;
  }

  private async processLocked(tx: Prisma.TransactionClient, event: GatewayEvent): Promise<Outcome> {
    const outcome = await this.dispatch(tx, event);
    if (outcome.status === 'deferred') {
      this.logger.warn(
        { stripeEventId: event.id, type: event.type },
        'stripe webhook: event deferred for the stuck-event sweep',
      );
      return DEFERRED;
    }
    await tx.stripeEvent.update({ where: { id: event.id }, data: { processedAt: new Date() } });
    return outcome;
  }

  private async dispatch(tx: Prisma.TransactionClient, event: GatewayEvent): Promise<Outcome> {
    switch (event.type) {
      case 'payment_intent.succeeded':
        return this.onPaymentIntentSucceeded(tx, event);
      case 'payment_intent.payment_failed':
        return this.onPaymentIntentFailed(tx, event);
      case 'account.updated':
        return {
          status: 'processed',
          afterCommit: await this.connect.applyAccountUpdated(
            tx,
            parseConnectedAccount(event.data.object),
          ),
        };
      default:
        this.logger.log(
          { stripeEventId: event.id, type: event.type },
          'stripe webhook: event type not handled, recorded only',
        );
        return PROCESSED;
    }
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
    try {
      assertQuoteFeeMatches(quote);
    } catch (error) {
      if (error instanceof PlatformFeeMismatchError) {
        this.logger.error(
          { ...logIds, quoteId: quote.id },
          'stripe webhook: quote platform fee does not match the shared helper; investigate before the booking can proceed',
        );
        return DEFERRED;
      }
      throw error;
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
        const log = { ...logIds, chargeId, status: booking.status };
        if (booking.status === 'paid_held' && booking.chargeId === chargeId) {
          this.logger.warn(log, 'stripe webhook: booking already paid for this charge');
        } else {
          this.logger.error(
            log,
            'stripe webhook: payment succeeded for a booking that cannot become paid_held; it needs a manual refund decision',
          );
        }
        return PROCESSED;
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
