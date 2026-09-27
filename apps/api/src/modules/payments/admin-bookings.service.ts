import { HttpException, Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@photoo/db';
import type { AdminBookingSchema, CursorPaginationQuerySchema } from '@photoo/shared';
import type { z } from 'zod';
import {
  decodeCreatedAtCursor,
  encodeCreatedAtCursor,
} from '../../common/pagination/created-at-cursor.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { BOOKING_INCLUDE, toBookingDtos, type BookingRow } from '../bookings/booking-dto.js';
import { ledgerTotalsByBooking } from './booking-ledger.js';

export type AdminBookingDto = z.infer<typeof AdminBookingSchema>;
type ListQuery = z.infer<typeof CursorPaginationQuerySchema>;

@Injectable()
export class AdminBookingsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(query: ListQuery): Promise<{ items: AdminBookingDto[]; nextCursor: string | null }> {
    const cursor = query.cursor ? decodeCreatedAtCursor(query.cursor) : undefined;
    const where: Prisma.BookingWhereInput = cursor
      ? {
          OR: [
            { createdAt: { lt: new Date(cursor.createdAt) } },
            { createdAt: new Date(cursor.createdAt), id: { gt: cursor.id } },
          ],
        }
      : {};
    const rows = await this.prisma.client.booking.findMany({
      where,
      include: BOOKING_INCLUDE,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: query.limit + 1,
    });
    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const last = page.at(-1);
    return {
      items: await this.toDtos(page),
      nextCursor: hasMore && last ? encodeCreatedAtCursor(last.createdAt, last.id) : null,
    };
  }

  async get(bookingId: string): Promise<AdminBookingDto> {
    const row = await this.prisma.client.booking.findUnique({
      where: { id: bookingId },
      include: BOOKING_INCLUDE,
    });
    if (!row) {
      throw new HttpException({ code: 'NOT_FOUND', message: 'Booking not found' }, 404);
    }
    const [dto] = await this.toDtos([row]);
    if (!dto) {
      throw new Error(`admin bookings: booking ${bookingId} vanished while mapping it`);
    }
    return dto;
  }

  private async toDtos(rows: BookingRow[]): Promise<AdminBookingDto[]> {
    const ids = rows.map((row) => row.id);
    const [bookings, totals, disputes] = await Promise.all([
      toBookingDtos(this.prisma.client, rows),
      ledgerTotalsByBooking(this.prisma.client, ids),
      this.prisma.client.dispute.findMany({
        where: { bookingId: { in: ids } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        distinct: ['bookingId'],
        select: { bookingId: true, status: true },
      }),
    ]);
    const disputeStatus = new Map(disputes.map((row) => [row.bookingId, row.status]));
    return bookings.map((booking, index) => {
      const row = rows[index];
      if (!row) {
        throw new Error(`admin bookings: no row for booking ${booking.id}`);
      }
      const ledger = totals.get(row.id);
      return {
        ...booking,
        paymentIntentId: row.paymentIntentId,
        chargeId: row.chargeId,
        transferId: row.transferId,
        refundedCents: ledger?.refundedCents ?? 0,
        reversedCents: ledger?.reversedCents ?? 0,
        disputeStatus: disputeStatus.get(row.id) ?? null,
      };
    });
  }
}
