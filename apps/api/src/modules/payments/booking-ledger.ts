import type { Prisma, PrismaClient } from '@photoo/db';

type LedgerReader = Pick<PrismaClient, 'ledgerEntry'> | Prisma.TransactionClient;

export interface BookingLedgerTotals {
  refundedCents: number;
  refundCount: number;
  transferredCents: number;
  reversedCents: number;
  reversalCount: number;
}

export const EMPTY_LEDGER_TOTALS: Readonly<BookingLedgerTotals> = {
  refundedCents: 0,
  refundCount: 0,
  transferredCents: 0,
  reversedCents: 0,
  reversalCount: 0,
};

// Refund and transfer rows are negative, reversal rows positive
// (docs/DATA-MODEL.md); the totals here are all reported as positive amounts.
export async function ledgerTotalsByBooking(
  db: LedgerReader,
  bookingIds: string[],
): Promise<Map<string, BookingLedgerTotals>> {
  const totals = new Map<string, BookingLedgerTotals>();
  if (bookingIds.length === 0) {
    return totals;
  }
  const groups = await db.ledgerEntry.groupBy({
    by: ['bookingId', 'type'],
    where: { bookingId: { in: bookingIds }, type: { in: ['refund', 'transfer', 'reversal'] } },
    _sum: { amountCents: true },
    _count: { _all: true },
  });
  for (const group of groups) {
    const current = totals.get(group.bookingId) ?? { ...EMPTY_LEDGER_TOTALS };
    const sum = group._sum.amountCents ?? 0;
    if (group.type === 'refund') {
      current.refundedCents = -sum;
      current.refundCount = group._count._all;
    } else if (group.type === 'transfer') {
      current.transferredCents = -sum;
    } else {
      current.reversedCents = sum;
      current.reversalCount = group._count._all;
    }
    totals.set(group.bookingId, current);
  }
  return totals;
}

export async function ledgerTotals(
  db: LedgerReader,
  bookingId: string,
): Promise<BookingLedgerTotals> {
  const totals = await ledgerTotalsByBooking(db, [bookingId]);
  return totals.get(bookingId) ?? { ...EMPTY_LEDGER_TOTALS };
}

export function reversibleCents(totals: BookingLedgerTotals): number {
  return totals.transferredCents - totals.reversedCents;
}
