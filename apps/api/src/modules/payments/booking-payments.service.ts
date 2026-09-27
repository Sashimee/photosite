import { HttpException, Inject, Injectable } from '@nestjs/common';
import type { PaymentIntentResponseSchema } from '@photoo/shared';
import { Logger } from 'nestjs-pino';
import type { z } from 'zod';
import { PrismaService } from '../../prisma/prisma.service.js';
import { assertQuoteFeeMatches, assertSupportedCurrency } from '../bookings/create-booking.js';
import { STRIPE_GATEWAY, type PaymentIntent, type StripeGateway } from './stripe/stripe-gateway.js';

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
    const booking = await this.prisma.client.booking.findUnique({
      where: { id: bookingId },
      include: { quote: true },
    });
    if (booking?.clientId !== user.id) {
      throw bookingNotFound();
    }
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
    const amount = { amountCents: quote.totalCents, currency: quote.currency };

    const intent =
      booking.paymentIntentId === null
        ? await this.createAndStore(booking.id, amount)
        : await this.gateway.retrievePaymentIntent(booking.paymentIntentId);

    this.assertIntentMatches(booking.id, intent, amount);
    return { clientSecret: intent.clientSecret, amount };
  }

  private async createAndStore(
    bookingId: string,
    amount: { amountCents: number; currency: string },
  ): Promise<PaymentIntent> {
    const created = await this.gateway.createPaymentIntent({
      amountCents: amount.amountCents,
      currency: amount.currency,
      transferGroup: transferGroupFor(bookingId),
      metadata: { bookingId },
      idempotencyKey: paymentIntentIdempotencyKey(bookingId),
    });

    const stored = await this.prisma.client.booking.updateMany({
      where: { id: bookingId, paymentIntentId: null },
      data: { paymentIntentId: created.id },
    });
    if (stored.count === 1) {
      this.logger.log(
        { bookingId, paymentIntentId: created.id },
        'payments: payment intent stored on booking',
      );
      return created;
    }

    // A concurrent call stored its intent first (possible once the 24h Stripe
    // idempotency window has passed); the stored one is the one to confirm.
    const current = await this.prisma.client.booking.findUniqueOrThrow({
      where: { id: bookingId },
      select: { paymentIntentId: true },
    });
    if (current.paymentIntentId === null) {
      throw new Error(
        `payments: booking ${bookingId} lost its payment intent while storing ${created.id}`,
      );
    }
    this.logger.warn(
      { bookingId, paymentIntentId: current.paymentIntentId, discardedPaymentIntentId: created.id },
      'payments: concurrent payment intent creation, reusing the stored one',
    );
    return current.paymentIntentId === created.id
      ? created
      : this.gateway.retrievePaymentIntent(current.paymentIntentId);
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
