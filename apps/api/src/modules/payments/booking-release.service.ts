import { HttpException, Inject, Injectable } from '@nestjs/common';
import { payoutAmount } from '@photoo/shared';
import { Logger } from 'nestjs-pino';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  IllegalBookingTransitionError,
  transitionBooking,
  type BookingTransition,
} from '../bookings/booking-state.js';
import { assertQuoteFeeMatches, assertSupportedCurrency } from '../bookings/create-booking.js';
import { transferGroupFor } from './booking-payments.service.js';
import { STRIPE_GATEWAY, type StripeGateway } from './stripe/stripe-gateway.js';

const RELEASE_TRANSACTION_TIMEOUT_MS = 15_000;
const RELEASE_SWEEP_BATCH_SIZE = 100;

export type ReleaseActor = BookingTransition['actor'];

export type ReleaseOutcome =
  | { status: 'released'; transferId: string; amountCents: number }
  | { status: 'skipped'; reason: 'disputed' | 'already_released' };

export interface ReleaseSweepResult {
  attempted: number;
  released: number;
  skipped: number;
  failed: number;
}

export function transferIdempotencyKey(bookingId: string): string {
  return `booking_${bookingId}_transfer`;
}

@Injectable()
export class BookingReleaseService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(STRIPE_GATEWAY) private readonly gateway: StripeGateway,
    @Inject(Logger) private readonly logger: Logger,
  ) {}

  // The single path that moves held funds to the photographer, shared by
  // accept-delivery and the booking-release job. The row lock serialises the
  // two, and the Stripe idempotency key makes a transfer created by a run
  // whose transaction then rolled back come back unchanged on the retry.
  async release(
    bookingId: string,
    actor: ReleaseActor,
    now: Date = new Date(),
  ): Promise<ReleaseOutcome> {
    return this.prisma.client.$transaction(
      async (tx) => {
        const [locked] = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM "Booking" WHERE id = ${bookingId} FOR UPDATE`;
        if (!locked) {
          throw new HttpException({ code: 'NOT_FOUND', message: 'Booking not found' }, 404);
        }
        const booking = await tx.booking.findUniqueOrThrow({
          where: { id: locked.id },
          include: {
            quote: true,
            delivery: { select: { acceptedAt: true } },
            photographer: { select: { stripeAccountId: true } },
          },
        });

        if (booking.status === 'disputed') {
          this.logger.log({ bookingId }, 'booking release: skipped, booking is disputed');
          return { status: 'skipped', reason: 'disputed' };
        }
        if (booking.status === 'released' || booking.transferId !== null) {
          return { status: 'skipped', reason: 'already_released' };
        }
        if (booking.status !== 'delivered') {
          throw new IllegalBookingTransitionError(booking.id, booking.status, 'released');
        }
        const openDisputes = await tx.dispute.count({
          where: { bookingId: booking.id, status: 'open' },
        });
        if (openDisputes > 0) {
          this.logger.warn(
            { bookingId },
            'booking release: skipped, an open dispute exists on a delivered booking',
          );
          return { status: 'skipped', reason: 'disputed' };
        }

        const accepted = booking.delivery?.acceptedAt != null;
        const due = booking.releaseDueAt !== null && booking.releaseDueAt <= now;
        if (!accepted && !due) {
          throw new HttpException(
            {
              code: 'CONFLICT',
              message:
                'Booking is not due for release: the client has not accepted the delivery and releaseDueAt has not passed',
            },
            409,
          );
        }
        if (booking.chargeId === null) {
          throw new Error(
            `booking release: booking ${booking.id} is delivered but has no chargeId; reconcile the charge before releasing`,
          );
        }
        const destination = booking.photographer.stripeAccountId;
        if (destination === null) {
          throw new Error(
            `booking release: photographer of booking ${booking.id} has no Stripe account; funds stay held until one is connected`,
          );
        }

        const { quote } = booking;
        assertSupportedCurrency(quote.currency);
        assertQuoteFeeMatches(quote);
        const amountCents = payoutAmount(quote);
        if (amountCents <= 0) {
          throw new Error(
            `booking release: booking ${booking.id} has nothing to transfer (subtotal ${String(quote.subtotalCents)}, fee ${String(quote.platformFeeCents)}); resolve it by hand`,
          );
        }

        const transfer = await this.gateway.createTransfer({
          amountCents,
          currency: quote.currency,
          destinationAccountId: destination,
          sourceTransactionId: booking.chargeId,
          transferGroup: transferGroupFor(booking.id),
          metadata: { bookingId: booking.id },
          idempotencyKey: transferIdempotencyKey(booking.id),
        });
        if (transfer.amountCents !== amountCents || transfer.destinationAccountId !== destination) {
          throw new Error(
            `booking release: transfer ${transfer.id} for booking ${booking.id} does not match the expected amount or destination; investigate before retrying`,
          );
        }

        await tx.ledgerEntry.createMany({
          data: [
            {
              bookingId: booking.id,
              type: 'transfer',
              amountCents: -amountCents,
              currency: quote.currency,
              stripeObjectId: transfer.id,
            },
            {
              bookingId: booking.id,
              type: 'platform_fee',
              amountCents: -quote.platformFeeCents,
              currency: quote.currency,
              stripeObjectId: transfer.id,
            },
          ],
        });
        await transitionBooking(tx, {
          bookingId: booking.id,
          from: 'delivered',
          to: 'released',
          actor,
          data: { transferId: transfer.id },
          audit: {
            transferId: transfer.id,
            amountCents,
            platformFeeCents: quote.platformFeeCents,
            trigger: accepted ? 'accepted' : 'release_due',
          },
        });
        this.logger.log(
          { bookingId: booking.id, transferId: transfer.id, chargeId: booking.chargeId },
          'booking release: transfer created and booking released',
        );
        return { status: 'released', transferId: transfer.id, amountCents };
      },
      { timeout: RELEASE_TRANSACTION_TIMEOUT_MS },
    );
  }

  async sweep(now: Date = new Date()): Promise<ReleaseSweepResult> {
    const due = await this.prisma.client.booking.findMany({
      where: {
        status: 'delivered',
        OR: [{ releaseDueAt: { lte: now } }, { delivery: { acceptedAt: { not: null } } }],
      },
      orderBy: [{ releaseDueAt: 'asc' }, { id: 'asc' }],
      take: RELEASE_SWEEP_BATCH_SIZE,
      select: { id: true },
    });
    const result: ReleaseSweepResult = {
      attempted: due.length,
      released: 0,
      skipped: 0,
      failed: 0,
    };
    for (const { id } of due) {
      try {
        const outcome = await this.release(id, { type: 'system', id: null }, now);
        result[outcome.status] += 1;
      } catch (error) {
        result.failed += 1;
        this.logger.error({ bookingId: id, err: error }, 'booking release: release failed');
      }
    }
    if (due.length > 0) {
      this.logger.log(result, 'booking release: sweep finished');
    }
    return result;
  }
}
