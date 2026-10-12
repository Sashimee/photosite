import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { HttpException, Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@photoo/db';
import {
  ADMIN_BOOKING_LEDGER_LIMIT,
  ADMIN_BOOKINGS_EXPORT_COLUMNS,
  ADMIN_BOOKINGS_EXPORT_ROW_CAP,
  ADMIN_BOOKINGS_EXPORT_TRUNCATED_LINE,
  IdSchema,
  formatMinorUnits,
  type AdminBookingDetailSchema,
  type AdminBookingSchema,
  type AdminBookingsExportQuerySchema,
  type AdminBookingsQuerySchema,
  type AdminLedgerEntrySchema,
} from '@photoo/shared';
import { z } from 'zod';
import { decodeCursor, encodeCursor } from '../../common/pagination/cursor.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AdminAuditService } from '../admin/admin-audit.service.js';
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
type FilterQuery = z.infer<typeof AdminBookingsExportQuerySchema>;
type ExportColumn = (typeof ADMIN_BOOKINGS_EXPORT_COLUMNS)[number];
type Db = PrismaService['client'] | Prisma.TransactionClient;

const LEDGER_ENTRY_SELECT = {
  id: true,
  type: true,
  amountCents: true,
  currency: true,
  stripeObjectId: true,
  occurredAt: true,
} as const;

const KEYSET_ORDER: Prisma.BookingOrderByWithRelationInput[] = [
  { createdAt: 'desc' },
  { id: 'asc' },
];

export const EXPORT_BATCH_SIZE = 500;

const CSV_INJECTION_LEAD = /^[=+\-@\t\r]/;

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

function filterWhere(query: FilterQuery): Prisma.BookingWhereInput[] {
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

function afterKey(createdAt: Date, id: string): Prisma.BookingWhereInput {
  return {
    OR: [{ createdAt: { lt: createdAt } }, { createdAt, id: { gt: id } }],
  };
}

// Spreadsheet apps evaluate a cell that starts with a formula character even
// inside quotes, so the `'` prefix is what stops a crafted id or reason from
// running as a formula on the finance team's machine.
export function csvCell(value: string | null): string {
  if (value === null) {
    return '""';
  }
  const safe = CSV_INJECTION_LEAD.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function csvLine(values: readonly (string | null)[]): string {
  return `${values.map(csvCell).join(',')}\r\n`;
}

export function exportFilters(query: FilterQuery) {
  return {
    status: query.status ?? null,
    createdFrom: query.createdFrom ?? null,
    createdTo: query.createdTo ?? null,
    dispute: query.dispute ?? null,
  };
}

export function exportFilename(query: FilterQuery, now: Date): string {
  const from = query.createdFrom ?? 'all';
  const to = query.createdTo ?? now.toISOString().slice(0, 10);
  return `photoo-bookings-${from}-${to}.csv`;
}

function exportRecord(dto: AdminBookingDto, createdAt: Date): string[] {
  const { currency } = dto.total;
  const cells: Record<ExportColumn, string | null> = {
    id: dto.id,
    status: dto.status,
    currency,
    total: formatMinorUnits(dto.total.amountCents, currency),
    refunded: formatMinorUnits(dto.refundedCents, currency),
    reversed: formatMinorUnits(dto.reversedCents, currency),
    disputeStatus: dto.disputeStatus,
    createdAt: createdAt.toISOString(),
    releasedAt: dto.releasedAt,
    deliveredAt: dto.deliveredAt,
    cancelledAt: dto.cancelledAt,
    paymentIntentId: dto.paymentIntentId,
    chargeId: dto.chargeId,
    transferId: dto.transferId,
  };
  return ADMIN_BOOKINGS_EXPORT_COLUMNS.map((column) => cells[column] ?? '');
}

export interface ExportLimits {
  batchSize: number;
  cap: number;
}

interface ExportBatch {
  rows: BookingRow[];
  dtos: AdminBookingDto[];
  hasMore: boolean;
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
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AdminAuditService) private readonly adminAudit: AdminAuditService,
  ) {}

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
      where.push(afterKey(new Date(cursor.createdAt), cursor.id));
    }
    const rows = await this.prisma.client.booking.findMany({
      where: { AND: where },
      include: BOOKING_INCLUDE,
      orderBy: KEYSET_ORDER,
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

  // The audit row and the first batch are written and read before any byte is
  // sent, so a failure there still answers with the JSON error shape instead
  // of a cut file. Later batches are separate reads: holding one snapshot
  // open for the whole download would pin a connection for as long as the
  // client takes to read it.
  async exportCsv(
    admin: { id: string },
    query: FilterQuery,
    ip: string | null,
    limits: ExportLimits = { batchSize: EXPORT_BATCH_SIZE, cap: ADMIN_BOOKINGS_EXPORT_ROW_CAP },
  ): Promise<{ filename: string; body: Readable }> {
    await this.prisma.client.$transaction((tx) =>
      this.adminAudit.record(tx, {
        actorId: admin.id,
        action: 'admin.bookings_exported',
        targetType: 'Booking',
        targetId: null,
        after: { filters: exportFilters(query), cap: limits.cap },
        ip,
      }),
    );
    const where = filterWhere(query);
    const first = await this.exportBatch(where, Math.min(limits.batchSize, limits.cap));
    return {
      filename: exportFilename(query, new Date()),
      body: Readable.from(this.csvChunks(where, first, limits), { objectMode: false }),
    };
  }

  private async *csvChunks(
    where: Prisma.BookingWhereInput[],
    first: ExportBatch,
    limits: ExportLimits,
  ): AsyncGenerator<string> {
    yield csvLine(ADMIN_BOOKINGS_EXPORT_COLUMNS);
    let batch = first;
    let written = 0;
    for (;;) {
      yield batch.dtos
        .map((dto, index) => {
          const row = batch.rows[index];
          if (!row) {
            throw new Error(`admin bookings export: no row for booking ${dto.id}`);
          }
          return csvLine(exportRecord(dto, row.createdAt));
        })
        .join('');
      written += batch.rows.length;
      const last = batch.rows.at(-1);
      if (!batch.hasMore || !last) {
        return;
      }
      if (written >= limits.cap) {
        yield `${ADMIN_BOOKINGS_EXPORT_TRUNCATED_LINE}\r\n`;
        return;
      }
      batch = await this.exportBatch(
        [...where, afterKey(last.createdAt, last.id)],
        Math.min(limits.batchSize, limits.cap - written),
      );
    }
  }

  private async exportBatch(where: Prisma.BookingWhereInput[], size: number): Promise<ExportBatch> {
    const rows = await this.prisma.client.booking.findMany({
      where: { AND: where },
      include: BOOKING_INCLUDE,
      orderBy: KEYSET_ORDER,
      take: size + 1,
    });
    const page = rows.slice(0, size);
    return {
      rows: page,
      dtos: await this.toDtos(this.prisma.client, page),
      hasMore: rows.length > size,
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
