import { Prisma, type Booking, type PrismaClient } from '@photoo/db';
import type { BookingSchema } from '@photoo/shared';
import type { z } from 'zod';

export type BookingDto = z.infer<typeof BookingSchema>;

export type BookingRow = Booking & { quote: { totalCents: number; currency: string } };

export const BOOKING_INCLUDE = {
  quote: { select: { totalCents: true, currency: true } },
} as const;

interface LocationRow {
  id: string;
  lat: number;
  lng: number;
}

type LocationReader = Pick<PrismaClient, '$queryRaw'> | Prisma.TransactionClient;

export async function toBookingDtos(db: LocationReader, rows: BookingRow[]): Promise<BookingDto[]> {
  if (rows.length === 0) {
    return [];
  }
  // Booking.location is a PostGIS column Prisma cannot select.
  const locations = await db.$queryRaw<LocationRow[]>`
    SELECT id, ST_Y(location::geometry) AS "lat", ST_X(location::geometry) AS "lng"
    FROM "Booking"
    WHERE id IN (${Prisma.join(rows.map((row) => row.id))}) AND location IS NOT NULL`;
  const byId = new Map(locations.map((row) => [row.id, { lat: row.lat, lng: row.lng }]));
  return rows.map((row) => toBookingDto(row, byId.get(row.id) ?? null));
}

export function toBookingDto(
  row: BookingRow,
  location: { lat: number; lng: number } | null,
): BookingDto {
  return {
    id: row.id,
    quoteId: row.quoteId,
    clientId: row.clientId,
    photographerId: row.photographerId,
    scheduledAt: row.scheduledAt?.toISOString() ?? null,
    location,
    total: { amountCents: row.quote.totalCents, currency: row.quote.currency },
    status: row.status,
    releaseDueAt: row.releaseDueAt?.toISOString() ?? null,
    deliveredAt: row.deliveredAt?.toISOString() ?? null,
    releasedAt: row.releasedAt?.toISOString() ?? null,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    cancellationReason: row.cancellationReason,
  };
}
