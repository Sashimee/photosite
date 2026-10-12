import { HttpException, Inject, Injectable } from '@nestjs/common';
import type { PaymentIntentResponseSchema } from '@photoo/shared';
import { Logger } from 'nestjs-pino';
import type { z } from 'zod';
import { PrismaService } from '../../prisma/prisma.service.js';
import { assertQuoteFeeMatches, assertSupportedCurrency } from '../bookings/create-booking.js';
import { STRIPE_GATEWAY, type PaymentIntent, type StripeGateway } from './stripe/stripe-gateway.js';

const PAYMENT_INTENT_TRANSACTION_TIMEOUT_MS = 15_000;

type PaymentIntentDto = z.infer<typeof PaymentIntentResponseSchema>;

interface SessionUser {
  id: string;
}

function bookingNotFound(): HttpException {
  return new HttpException({ code: 'NOT_FOUND', message: 'Booking not found' }, 404);
}

export function paymentIntentIdempotencyKey(bookingId: string): string {
  return `booking_${bookingId}_pi`;
}

export function transferGroupFor(bookingId: string): string {
  return `booking_${bookingId}`;
}

@Injectable()
export class BookingPaymentsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(STRIPE_GATEWAY) private readonly gateway: StripeGateway,
    @Inject(Logger) private readonly logger: Logger,
  ) {}

  async createPaymentIntent(user: SessionUser, bookingId: string): Promise<PaymentIntentDto> {
    // The row lock makes a concurrent cancel or second pay call wait for the stored
    // paymentIntentId; the timeout covers the idempotent Stripe call made under it.
    const locked = await this.prisma.client.$transaction(
      async (tx) => {
        const [locked] = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM "Booking" WHERE id = ${bookingId} AND "clientId" = ${user.id} FOR UPDATE`;
        if (!locked) {
          throw bookingNotFound();
        }
        const booking = await tx.booking.findUniqueOrThrow({
          where: { id: locked.id },
          include: { quote: true },
        });
        if (booking.status !== 'pending_payment') {
          throw new HttpException(
            {
              code: 'CONFLICT',
              message: `Booking is ${booking.status}, only a booking awaiting payment can be paid`,
            },
            409,
          );
        }

        const { quote } = booking;
        assertSupportedCurrency(quote.currency);
        assertQuoteFeeMatches(quote);
        const quoted = { amountCents: quote.totalCents, currency: quote.currency };
        if (booking.paymentIntentId !== null) {
          return { intent: null, storedId: booking.paymentIntentId, amount: quoted };
        }
        const created = await this.gateway.createPaymentIntent({
          amountCents: quoted.amountCents,
          currency: quoted.currency,
          transferGroup: transferGroupFor(booking.id),
          metadata: { bookingId: booking.id },
          idempotencyKey: paymentIntentIdempotencyKey(booking.id),
        });
        await tx.booking.update({
          where: { id: booking.id },
          data: { paymentIntentId: created.id },
        });
        this.logger.log(
          { bookingId: booking.id, paymentIntentId: created.id },
          'payments: payment intent stored on booking',
        );
        return { intent: created, storedId: created.id, amount: quoted };
      },
      { timeout: PAYMENT_INTENT_TRANSACTION_TIMEOUT_MS },
    );

    const { amount } = locked;
    const intent = locked.intent ?? (await this.gateway.retrievePaymentIntent(locked.storedId));
    this.assertIntentMatches(bookingId, intent, amount);
    return { clientSecret: intent.clientSecret, amount };
  }

  private assertIntentMatches(
    bookingId: string,
    intent: PaymentIntent,
    amount: { amountCents: number; currency: string },
  ): void {
    if (intent.amountCents !== amount.amountCents || intent.currency !== amount.currency) {
      this.logger.error(
        { bookingId, paymentIntentId: intent.id },
        'payments: stored payment intent amount or currency differs from the quote',
      );
      throw new Error(
        `payments: payment intent ${intent.id} for booking ${bookingId} does not match the quote amount; investigate before charging`,
      );
    }
  }
}
