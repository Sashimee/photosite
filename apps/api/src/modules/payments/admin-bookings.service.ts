import { createHash } from 'node:crypto';
import { HttpException, Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@photoo/db';
import {
  ADMIN_BOOKING_LEDGER_LIMIT,
  IdSchema,
  type AdminBookingDetailSchema,
  type AdminBookingSchema,
  type AdminBookingsQuerySchema,
  type AdminLedgerEntrySchema,
} from '@photoo/shared';
import { z } from 'zod';
import { decodeCursor, encodeCursor } from '../../common/pagination/cursor.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { BOOKING_INCLUDE, toBookingDtos, type BookingRow } from '../bookings/booking-dto.js';
import {
  EMPTY_LEDGER_TOTALS,
  ledgerTotalsByBooking,
  type BookingLedgerTotals,
} from './booking-ledger.js';

export type AdminBookingDto = z.infer<typeof AdminBookingSchema>;
export type AdminBookingDetailDto = z.infer<typeof AdminBookingDetailSchema>;
type AdminLedgerEntryDto = z.infer<typeof AdminLedgerEntrySchema>;
type ListQuery = z.infer<typeof AdminBookingsQuerySchema>;
type Db = PrismaService['client'] | Prisma.TransactionClient;

const LEDGER_ENTRY_SELECT = {
  id: true,
  type: true,
  amountCents: true,
  currency: true,
  stripeObjectId: true,
  occurredAt: true,
} as const;

const FilteredCursorSchema = z
  .object({
    createdAt: z.iso.datetime({ offset: true }),
    id: IdSchema,
    filter: z.string().min(1),
  })
  .strict();

export function filterFingerprint(query: ListQuery): string {
  const canonical = JSON.stringify([
    query.status ?? null,
    query.createdFrom ?? null,
    query.createdTo ?? null,
    query.dispute ?? null,
  ]);
  return createHash('sha256').update(canonical).digest('base64url').slice(0, 22);
}

function filterWhere(query: ListQuery): Prisma.BookingWhereInput[] {
  const where: Prisma.BookingWhereInput[] = [];
  if (query.status) {
    where.push({ status: { in: query.status } });
  }
  if (query.createdFrom !== undefined && query.createdTo !== undefined) {
    where.push({
      createdAt: {
        gte: new Date(`${query.createdFrom}T00:00:00.000Z`),
        lt: new Date(`${query.createdTo}T00:00:00.000Z`),
      },
    });
  }
  switch (query.dispute) {
    case undefined:
      break;
    case 'any':
      where.push({ disputes: { some: {} } });
      break;
    case 'open':
      where.push({ disputes: { some: { status: 'open' } } });
      break;
    case 'none':
      where.push({ disputes: { none: {} } });
      break;
    default: {
      const unreachable: never = query.dispute;
      throw new Error(`admin bookings: unknown dispute filter ${String(unreachable)}`);
    }
  }
  return where;
}

export function moneyHints(
  status: AdminBookingDto['status'],
  totalCents: number,
  totals: BookingLedgerTotals,
): { refundableCents: number; reversibleCents: number } {
  const reversible = Math.max(0, totals.transferredCents - totals.reversedCents);
  const refundable =
    status === 'released'
      ? Math.max(0, Math.min(totalCents - totals.refundedCents, reversible))
      : 0;
  return { refundableCents: refundable, reversibleCents: reversible };
}

function toLedgerEntryDto(row: {
  id: string;
  type: AdminLedgerEntryDto['type'];
  amountCents: number;
  currency: string;
  stripeObjectId: string;
  occurredAt: Date;
}): AdminLedgerEntryDto {
  return { ...row, occurredAt: row.occurredAt.toISOString() };
}

function notFound(): HttpException {
  return new HttpException({ code: 'NOT_FOUND', message: 'Booking not found' }, 404);
}

@Injectable()
export class AdminBookingsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(query: ListQuery): Promise<{ items: AdminBookingDto[]; nextCursor: string | null }> {
    const fingerprint = filterFingerprint(query);
    const where = filterWhere(query);
    if (query.cursor) {
      const cursor = decodeCursor(query.cursor, FilteredCursorSchema);
      if (cursor.filter !== fingerprint) {
        throw new HttpException(
          {
            code: 'BAD_REQUEST',
            message: 'Cursor belongs to a different filter set; restart from the first page',
          },
          400,
        );
      }
      where.push({
        OR: [
          { createdAt: { lt: new Date(cursor.createdAt) } },
          { createdAt: new Date(cursor.createdAt), id: { gt: cursor.id } },
        ],
      });
    }
    const rows = await this.prisma.client.booking.findMany({
      where: { AND: where },
      include: BOOKING_INCLUDE,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: query.limit + 1,
    });
    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const last = page.at(-1);
    return {
      items: await this.toDtos(this.prisma.client, page),
      nextCursor:
        hasMore && last
          ? encodeCursor({
              createdAt: last.createdAt.toISOString(),
              id: last.id,
              filter: fingerprint,
            })
          : null,
    };
  }

  // One snapshot, so the ledger rows, their sums and the hints on the page
  // agree with each other, and the expected sums the admin sends back are
  // exactly the ones the rows add up to.
  get(bookingId: string): Promise<AdminBookingDetailDto> {
    return this.prisma.client.$transaction((tx) => this.detail(tx, bookingId), {
      isolationLevel: 'RepeatableRead',
    });
  }

  private async detail(tx: Prisma.TransactionClient, bookingId: string) {
    const row = await tx.booking.findUnique({
      where: { id: bookingId },
      include: {
        ...BOOKING_INCLUDE,
        photographer: {
          select: {
            stripeAccountId: true,
            stripeOnboardingComplete: true,
            stripePayoutsEnabled: true,
          },
        },
      },
    });
    if (!row) {
      throw notFound();
    }
    const [dtos, ledger, payoutEntries, disputes] = await Promise.all([
      this.toDtos(tx, [row]),
      tx.ledgerEntry.findMany({
        where: { bookingId },
        select: LEDGER_ENTRY_SELECT,
        orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
        take: ADMIN_BOOKING_LEDGER_LIMIT + 1,
      }),
      tx.ledgerEntry.findMany({
        where: { bookingId, type: 'payout' },
        select: LEDGER_ENTRY_SELECT,
        orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
      }),
      tx.dispute.findMany({
        where: { bookingId },
        select: {
          id: true,
          status: true,
          reason: true,
          resolution: true,
          amountRefundedCents: true,
          openedById: true,
          adminId: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
    ]);
    const [dto] = dtos;
    if (!dto) {
      throw new Error(`admin bookings: booking ${bookingId} vanished while mapping it`);
    }
    const { photographer } = row;
    return {
      ...dto,
      ledger: ledger.slice(0, ADMIN_BOOKING_LEDGER_LIMIT).map(toLedgerEntryDto),
      ledgerTruncated: ledger.length > ADMIN_BOOKING_LEDGER_LIMIT,
      disputes: disputes.map(({ createdAt, updatedAt, ...dispute }) => ({
        ...dispute,
        openedAt: createdAt.toISOString(),
        updatedAt: updatedAt.toISOString(),
      })),
      payout:
        photographer.stripeAccountId === null
          ? null
          : {
              stripeAccountId: photographer.stripeAccountId,
              onboardingComplete: photographer.stripeOnboardingComplete,
              payoutsEnabled: photographer.stripePayoutsEnabled,
              entries: payoutEntries.map(toLedgerEntryDto),
            },
    };
  }

  private async toDtos(db: Db, rows: BookingRow[]): Promise<AdminBookingDto[]> {
    const ids = rows.map((row) => row.id);
    const [bookings, totals, disputes] = await Promise.all([
      toBookingDtos(db, rows),
      ledgerTotalsByBooking(db, ids),
      db.dispute.findMany({
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
      const ledger = totals.get(row.id) ?? EMPTY_LEDGER_TOTALS;
      return {
        ...booking,
        paymentIntentId: row.paymentIntentId,
        chargeId: row.chargeId,
        transferId: row.transferId,
        refundedCents: ledger.refundedCents,
        reversedCents: ledger.reversedCents,
        ...moneyHints(row.status, row.quote.totalCents, ledger),
        disputeStatus: disputeStatus.get(row.id) ?? null,
      };
    });
  }
}
