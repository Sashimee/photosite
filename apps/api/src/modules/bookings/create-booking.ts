import { HttpException } from '@nestjs/common';
import type { Prisma, Quote } from '@photoo/db';
import { calculatePlatformFee } from '@photoo/shared';

export const SUPPORTED_BOOKING_CURRENCY = 'EUR';

export class PlatformFeeMismatchError extends Error {
  constructor(
    readonly quoteId: string,
    readonly storedFeeCents: number,
    readonly recomputedFeeCents: number,
  ) {
    super(
      `booking: quote ${quoteId} platform fee ${String(storedFeeCents)} does not match the recomputed ${String(recomputedFeeCents)}; the quote snapshot is corrupt and must be investigated before it can be booked`,
    );
  }
}

export function assertSupportedCurrency(currency: string): void {
  if (currency !== SUPPORTED_BOOKING_CURRENCY) {
    throw new HttpException(
      {
        code: 'UNPROCESSABLE_ENTITY',
        message: `Only ${SUPPORTED_BOOKING_CURRENCY} bookings can be paid for now, this quote is in ${currency}`,
      },
      422,
    );
  }
}

export function assertQuoteFeeMatches(
  quote: Pick<Quote, 'id' | 'subtotalCents' | 'platformFeeCents' | 'feePercent'>,
): void {
  const recomputed = calculatePlatformFee(quote.subtotalCents, Number(quote.feePercent));
  if (recomputed !== quote.platformFeeCents) {
    throw new PlatformFeeMismatchError(quote.id, quote.platformFeeCents, recomputed);
  }
}

// Money on the booking is never stored twice: amounts are always read back
// from the accepted Quote snapshot, which is what the PaymentIntent charges.
export async function createBookingForAcceptedQuote(
  tx: Prisma.TransactionClient,
  quote: Quote,
  actor: { id: string; ip?: string | null },
): Promise<{ id: string }> {
  assertSupportedCurrency(quote.currency);
  assertQuoteFeeMatches(quote);

  const request = quote.requestId
    ? await tx.request.findUniqueOrThrow({
        where: { id: quote.requestId },
        select: { id: true, eventDate: true },
      })
    : null;

  const booking = await tx.booking.create({
    data: {
      quoteId: quote.id,
      clientId: quote.clientId,
      photographerId: quote.photographerId,
      scheduledAt: request?.eventDate ?? null,
      status: 'pending_payment',
    },
    select: { id: true },
  });

  // Booking.location is a PostGIS column Prisma models as Unsupported, so it
  // can only be copied in SQL.
  if (request) {
    await tx.$executeRaw`UPDATE "Booking" SET location = (SELECT location FROM "Request" WHERE id = ${request.id}) WHERE id = ${booking.id}`;
  }

  await tx.auditLog.create({
    data: {
      actorType: 'user',
      actorId: actor.id,
      action: 'booking.created',
      targetType: 'Booking',
      targetId: booking.id,
      after: {
        status: 'pending_payment',
        quoteId: quote.id,
        totalCents: quote.totalCents,
        platformFeeCents: quote.platformFeeCents,
        currency: quote.currency,
      },
      ip: actor.ip ?? null,
    },
  });

  return booking;
}
