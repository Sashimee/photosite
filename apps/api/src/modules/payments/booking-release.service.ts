import { HttpException, Inject, Injectable } from '@nestjs/common';
import { payoutAmount } from '@photoo/shared';
import { Logger } from 'nestjs-pino';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  IllegalBookingTransitionError,
  transitionBooking,
  type BookingTransition,
} from '../bookings/booking-state.js';
import { assertSupportedCurrency } from '../bookings/create-booking.js';
import { ledgerTotals } from './booking-ledger.js';
import { transferGroupFor } from './booking-payments.service.js';
import { STRIPE_GATEWAY, type StripeGateway, type Transfer } from './stripe/stripe-gateway.js';

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

interface ReleasePlan {
  bookingId: string;
  chargeId: string;
  destination: string;
  amountCents: number;
  platformFeeCents: number;
  currency: string;
  trigger: 'accepted' | 'release_due';
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
  // accept-delivery and the booking-release job. The Stripe call runs between
  // two short transactions so a slow or retried request never holds the row
  // lock or outlives the transaction timeout. A transfer created by a run that
  // then failed is found again by its transfer group on the retry: Stripe
  // prunes idempotency keys after 24 hours, and the sweep may retry later.
  async release(
    bookingId: string,
    actor: ReleaseActor,
    now: Date = new Date(),
  ): Promise<ReleaseOutcome> {
    const plan = await this.planRelease(bookingId, now);
    if ('status' in plan) {
      return plan;
    }
    const transfer = await this.findOrCreateTransfer(plan);
    return this.recordRelease(plan, transfer, actor);
  }

  private planRelease(
    bookingId: string,
    now: Date,
  ): Promise<ReleasePlan | Extract<ReleaseOutcome, { status: 'skipped' }>> {
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
          return { status: 'skipped', reason: 'disputed' } as const;
        }
        if (booking.status === 'released' || booking.transferId !== null) {
          return { status: 'skipped', reason: 'already_released' } as const;
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
          return { status: 'skipped', reason: 'disputed' } as const;
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
        // A client refund before release comes out of the photographer's share;
        // the platform fee on the quote is kept either way.
        const { refundedCents } = await ledgerTotals(tx, booking.id);
        const amountCents = payoutAmount(quote) - refundedCents;
        if (amountCents <= 0) {
          throw new Error(
            `booking release: booking ${booking.id} has nothing to transfer (subtotal ${String(quote.subtotalCents)}, fee ${String(quote.platformFeeCents)}, refunded ${String(refundedCents)}); resolve it by hand`,
          );
        }
        return {
          bookingId: booking.id,
          chargeId: booking.chargeId,
          destination,
          amountCents,
          platformFeeCents: quote.platformFeeCents,
          currency: quote.currency,
          trigger: accepted ? 'accepted' : 'release_due',
        } satisfies ReleasePlan;
      },
      { timeout: RELEASE_TRANSACTION_TIMEOUT_MS },
    );
  }

  private async findOrCreateTransfer(plan: ReleasePlan): Promise<Transfer> {
    const transferGroup = transferGroupFor(plan.bookingId);
    const existing = await this.gateway.findTransfer(transferGroup, plan.bookingId);
    const transfer =
      existing ??
      (await this.gateway.createTransfer({
        amountCents: plan.amountCents,
        currency: plan.currency,
        destinationAccountId: plan.destination,
        sourceTransactionId: plan.chargeId,
        transferGroup,
        metadata: { bookingId: plan.bookingId },
        idempotencyKey: transferIdempotencyKey(plan.bookingId),
      }));
    if (
      transfer.amountCents !== plan.amountCents ||
      transfer.currency !== plan.currency.toUpperCase() ||
      transfer.destinationAccountId !== plan.destination
    ) {
      throw new Error(
        `booking release: transfer ${transfer.id} for booking ${plan.bookingId} does not match the expected amount, currency or destination; investigate before retrying`,
      );
    }
    if (existing) {
      this.logger.log(
        { bookingId: plan.bookingId, transferId: transfer.id },
        'booking release: reusing the transfer of an earlier run',
      );
    }
    return transfer;
  }

  private async recordRelease(
    plan: ReleasePlan,
    transfer: Transfer,
    actor: ReleaseActor,
  ): Promise<ReleaseOutcome> {
    const recorded = await this.prisma.client.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Booking" WHERE id = ${plan.bookingId} FOR UPDATE`;
        const booking = await tx.booking.findUniqueOrThrow({
          where: { id: plan.bookingId },
          select: { status: true, transferId: true },
        });
        if (booking.transferId === transfer.id) {
          return { kind: 'already_recorded' } as const;
        }
        // The transfer has already moved the money, so its ledger rows are
        // written whatever state the booking reached meanwhile.
        await tx.ledgerEntry.createMany({
          data: [
            {
              bookingId: plan.bookingId,
              type: 'transfer',
              amountCents: -plan.amountCents,
              currency: plan.currency,
              stripeObjectId: transfer.id,
            },
            {
              bookingId: plan.bookingId,
              type: 'platform_fee',
              amountCents: -plan.platformFeeCents,
              currency: plan.currency,
              stripeObjectId: transfer.id,
            },
          ],
          skipDuplicates: true,
        });
        if (booking.status !== 'delivered' || booking.transferId !== null) {
          await tx.auditLog.create({
            data: {
              actorType: actor.type,
              actorId: actor.id,
              action: 'booking.release_conflict',
              targetType: 'Booking',
              targetId: plan.bookingId,
              before: { status: booking.status, transferId: booking.transferId },
              after: { transferId: transfer.id, amountCents: plan.amountCents },
            },
          });
          return { kind: 'conflict', status: booking.status } as const;
        }
        await transitionBooking(tx, {
          bookingId: plan.bookingId,
          from: 'delivered',
          to: 'released',
          actor,
          data: { transferId: transfer.id },
          audit: {
            transferId: transfer.id,
            amountCents: plan.amountCents,
            platformFeeCents: plan.platformFeeCents,
            trigger: plan.trigger,
          },
        });
        return { kind: 'released' } as const;
      },
      { timeout: RELEASE_TRANSACTION_TIMEOUT_MS },
    );

    if (recorded.kind === 'already_recorded') {
      return { status: 'skipped', reason: 'already_released' };
    }
    if (recorded.kind === 'conflict') {
      this.logger.error(
        {
          bookingId: plan.bookingId,
          transferId: transfer.id,
          bookingStatus: recorded.status,
        },
        'booking release: transfer created but the booking left delivered meanwhile; reverse or reconcile by hand',
      );
      throw new Error(
        `booking release: transfer ${transfer.id} was created but booking ${plan.bookingId} is now ${recorded.status}; reverse the transfer or reconcile the booking by hand`,
      );
    }
    this.logger.log(
      { bookingId: plan.bookingId, transferId: transfer.id, chargeId: plan.chargeId },
      'booking release: transfer created and booking released',
    );
    return { status: 'released', transferId: transfer.id, amountCents: plan.amountCents };
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
