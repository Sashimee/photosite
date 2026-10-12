import { HttpException } from '@nestjs/common';
import type { Logger } from 'nestjs-pino';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { EarningsService } from './earnings.service.js';
import type { PaymentsRateLimitService } from './payments-rate-limit.service.js';

const PHOTOGRAPHER = { id: 'user-1', roles: ['photographer'] };
const PROFILE_ID = 'profile-1';

interface LedgerGroupArgs {
  by: string[];
  where: { type: unknown };
}

interface HeldBookingRow {
  id: string;
  quote: { subtotalCents: number; platformFeeCents: number; currency: string };
}

interface Groups {
  released?: { currency: string; _sum: { amountCents: number | null } }[];
  heldBookings?: HeldBookingRow[];
  heldRefunds?: { bookingId: string; _sum: { amountCents: number | null } }[];
  recent?: {
    bookingId: string;
    currency: string;
    _sum: { amountCents: number | null };
    _max: { occurredAt: Date | null };
  }[];
}

function setup(options: { profile?: { id: string } | null; groups?: Groups } = {}) {
  const groups = options.groups ?? {};
  const ledgerGroupBy = vi.fn((args: LedgerGroupArgs) => {
    if (args.where.type === 'refund') {
      return Promise.resolve(groups.heldRefunds ?? []);
    }
    if (args.by.includes('bookingId')) {
      return Promise.resolve(groups.recent ?? []);
    }
    return Promise.resolve(groups.released ?? []);
  });
  const bookingFindMany = vi.fn(() => Promise.resolve(groups.heldBookings ?? []));
  const findUnique = vi.fn(() =>
    Promise.resolve(options.profile === undefined ? { id: PROFILE_ID } : options.profile),
  );
  const prisma = {
    client: {
      photographerProfile: { findUnique },
      ledgerEntry: { groupBy: ledgerGroupBy },
      booking: { findMany: bookingFindMany },
    },
  } as unknown as PrismaService;
  const enforceEarningsRead = vi.fn(() => Promise.resolve());
  const rateLimit = { enforceEarningsRead } as unknown as PaymentsRateLimitService;
  const logger = { warn: vi.fn() };
  return {
    service: new EarningsService(prisma, rateLimit, logger as unknown as Logger),
    ledgerGroupBy,
    bookingFindMany,
    findUnique,
    enforceEarningsRead,
    logger,
  };
}

describe('EarningsService.getOwn', () => {
  it('rejects a non-photographer with 403 before rate limiting or reading', async () => {
    const { service, enforceEarningsRead, findUnique } = setup();
    const error = await service
      .getOwn({ id: 'client-1', roles: ['client'] })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(403);
    expect(enforceEarningsRead).not.toHaveBeenCalled();
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('rate limits per user', async () => {
    const { service, enforceEarningsRead } = setup();
    await service.getOwn(PHOTOGRAPHER);
    expect(enforceEarningsRead).toHaveBeenCalledWith(PHOTOGRAPHER.id);
  });

  it('returns empty arrays when the photographer has no profile yet', async () => {
    const { service, ledgerGroupBy, bookingFindMany } = setup({ profile: null });
    await expect(service.getOwn(PHOTOGRAPHER)).resolves.toEqual({ totals: [], recent: [] });
    expect(ledgerGroupBy).not.toHaveBeenCalled();
    expect(bookingFindMany).not.toHaveBeenCalled();
  });

  it('returns empty arrays when there is nothing in the ledger or held', async () => {
    const { service } = setup();
    await expect(service.getOwn(PHOTOGRAPHER)).resolves.toEqual({ totals: [], recent: [] });
  });

  it('scopes every aggregate to the photographer profile id, not the user id', async () => {
    const { service, ledgerGroupBy, bookingFindMany, findUnique } = setup();
    await service.getOwn(PHOTOGRAPHER);
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: PHOTOGRAPHER.id } }),
    );
    for (const [args] of ledgerGroupBy.mock.calls) {
      expect(JSON.stringify(args)).toContain(`"photographerId":"${PROFILE_ID}"`);
      expect(JSON.stringify(args)).not.toContain(PHOTOGRAPHER.id);
    }
    expect(JSON.stringify(bookingFindMany.mock.calls)).toContain(
      `"photographerId":"${PROFILE_ID}"`,
    );
  });

  it('counts held only for unreleased statuses, excluding transferred bookings and lost disputes', async () => {
    const { service, bookingFindMany } = setup();
    await service.getOwn(PHOTOGRAPHER);
    expect(bookingFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          photographerId: PROFILE_ID,
          status: { in: ['paid_held', 'in_progress', 'delivered', 'disputed'] },
          ledgerEntries: { none: { type: 'transfer' } },
          disputes: { none: { status: 'lost' } },
        },
      }),
    );
  });

  it('negates transfer-minus-reversal sums into released and maps recent rows', async () => {
    const occurredAt = new Date('2026-10-01T10:00:00.000Z');
    const { service, ledgerGroupBy } = setup({
      groups: {
        released: [{ currency: 'EUR', _sum: { amountCents: -23797 + 2000 } }],
        recent: [
          {
            bookingId: 'booking-1',
            currency: 'EUR',
            _sum: { amountCents: -23797 + 2000 },
            _max: { occurredAt },
          },
        ],
      },
    });
    await expect(service.getOwn(PHOTOGRAPHER)).resolves.toEqual({
      totals: [{ currency: 'EUR', releasedCents: 21797, heldCents: 0 }],
      recent: [
        {
          bookingId: 'booking-1',
          amountCents: 21797,
          currency: 'EUR',
          occurredAt: '2026-10-01T10:00:00.000Z',
        },
      ],
    });
    expect(ledgerGroupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        by: ['bookingId', 'currency'],
        orderBy: [{ _max: { occurredAt: 'desc' } }, { bookingId: 'desc' }],
        take: 20,
      }),
    );
  });

  it('derives held from the stored subtotal and fee, less refunds before release', async () => {
    const { service } = setup({
      groups: {
        heldBookings: [
          { id: 'b1', quote: { subtotalCents: 25050, platformFeeCents: 1253, currency: 'EUR' } },
        ],
        heldRefunds: [{ bookingId: 'b1', _sum: { amountCents: -5000 } }],
      },
    });
    await expect(service.getOwn(PHOTOGRAPHER)).resolves.toEqual({
      totals: [{ currency: 'EUR', releasedCents: 0, heldCents: 25050 - 1253 - 5000 }],
      recent: [],
    });
  });

  it('keeps currencies apart and sorts them', async () => {
    const { service } = setup({
      groups: {
        released: [
          { currency: 'USD', _sum: { amountCents: -1000 } },
          { currency: 'EUR', _sum: { amountCents: -2000 } },
        ],
        heldBookings: [
          { id: 'b1', quote: { subtotalCents: 500, platformFeeCents: 25, currency: 'USD' } },
        ],
      },
    });
    await expect(service.getOwn(PHOTOGRAPHER)).resolves.toEqual({
      totals: [
        { currency: 'EUR', releasedCents: 2000, heldCents: 0 },
        { currency: 'USD', releasedCents: 1000, heldCents: 475 },
      ],
      recent: [],
    });
  });

  it('clamps an over-refunded booking to 0 held without touching other bookings, and warns', async () => {
    const { service, logger } = setup({
      groups: {
        heldBookings: [
          { id: 'over', quote: { subtotalCents: 10000, platformFeeCents: 500, currency: 'EUR' } },
          { id: 'ok', quote: { subtotalCents: 4000, platformFeeCents: 200, currency: 'EUR' } },
          { id: 'full', quote: { subtotalCents: 2000, platformFeeCents: 100, currency: 'EUR' } },
        ],
        heldRefunds: [
          { bookingId: 'over', _sum: { amountCents: -9600 } },
          { bookingId: 'full', _sum: { amountCents: -2000 } },
        ],
      },
    });
    await expect(service.getOwn(PHOTOGRAPHER)).resolves.toEqual({
      totals: [{ currency: 'EUR', releasedCents: 0, heldCents: 3800 }],
      recent: [],
    });
    expect(logger.warn).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ bookingId: 'over', heldCents: -100 }),
      expect.any(String),
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ bookingId: 'full', heldCents: -100 }),
      expect.any(String),
    );
  });

  it('does not warn for a booking refunded down to exactly 0 held', async () => {
    const { service, logger } = setup({
      groups: {
        heldBookings: [
          { id: 'b1', quote: { subtotalCents: 1000, platformFeeCents: 50, currency: 'EUR' } },
        ],
        heldRefunds: [{ bookingId: 'b1', _sum: { amountCents: -950 } }],
      },
    });
    await expect(service.getOwn(PHOTOGRAPHER)).resolves.toEqual({
      totals: [{ currency: 'EUR', releasedCents: 0, heldCents: 0 }],
      recent: [],
    });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('fails loudly on a negative released total instead of reporting it', async () => {
    const { service } = setup({
      groups: { released: [{ currency: 'EUR', _sum: { amountCents: 500 } }] },
    });
    await expect(service.getOwn(PHOTOGRAPHER)).rejects.toThrow(/negative EUR released total/);
  });
});
