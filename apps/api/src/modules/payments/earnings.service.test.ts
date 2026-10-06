import { HttpException } from '@nestjs/common';
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

interface Groups {
  released?: { currency: string; _sum: { amountCents: number | null } }[];
  heldQuotes?: {
    currency: string;
    _sum: { subtotalCents: number | null; platformFeeCents: number | null };
  }[];
  heldRefunds?: { currency: string; _sum: { amountCents: number | null } }[];
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
    if (args.by.includes('bookingId')) {
      return Promise.resolve(groups.recent ?? []);
    }
    if (args.where.type === 'refund') {
      return Promise.resolve(groups.heldRefunds ?? []);
    }
    return Promise.resolve(groups.released ?? []);
  });
  const quoteGroupBy = vi.fn(() => Promise.resolve(groups.heldQuotes ?? []));
  const findUnique = vi.fn(() =>
    Promise.resolve(options.profile === undefined ? { id: PROFILE_ID } : options.profile),
  );
  const prisma = {
    client: {
      photographerProfile: { findUnique },
      ledgerEntry: { groupBy: ledgerGroupBy },
      quote: { groupBy: quoteGroupBy },
    },
  } as unknown as PrismaService;
  const enforceEarningsRead = vi.fn(() => Promise.resolve());
  const rateLimit = { enforceEarningsRead } as unknown as PaymentsRateLimitService;
  return {
    service: new EarningsService(prisma, rateLimit),
    ledgerGroupBy,
    quoteGroupBy,
    findUnique,
    enforceEarningsRead,
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
    const { service, ledgerGroupBy, quoteGroupBy } = setup({ profile: null });
    await expect(service.getOwn(PHOTOGRAPHER)).resolves.toEqual({ totals: [], recent: [] });
    expect(ledgerGroupBy).not.toHaveBeenCalled();
    expect(quoteGroupBy).not.toHaveBeenCalled();
  });

  it('returns empty arrays when there is nothing in the ledger or held', async () => {
    const { service } = setup();
    await expect(service.getOwn(PHOTOGRAPHER)).resolves.toEqual({ totals: [], recent: [] });
  });

  it('scopes every aggregate to the photographer profile id, not the user id', async () => {
    const { service, ledgerGroupBy, quoteGroupBy, findUnique } = setup();
    await service.getOwn(PHOTOGRAPHER);
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: PHOTOGRAPHER.id } }),
    );
    for (const [args] of ledgerGroupBy.mock.calls) {
      expect(JSON.stringify(args)).toContain(`"photographerId":"${PROFILE_ID}"`);
      expect(JSON.stringify(args)).not.toContain(PHOTOGRAPHER.id);
    }
    expect(JSON.stringify(quoteGroupBy.mock.calls)).toContain(`"photographerId":"${PROFILE_ID}"`);
  });

  it('counts held only for unreleased statuses and excludes transferred bookings', async () => {
    const { service, quoteGroupBy } = setup();
    await service.getOwn(PHOTOGRAPHER);
    expect(quoteGroupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        by: ['currency'],
        where: {
          booking: {
            is: {
              photographerId: PROFILE_ID,
              status: { in: ['paid_held', 'in_progress', 'delivered', 'disputed'] },
              ledgerEntries: { none: { type: 'transfer' } },
            },
          },
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
        heldQuotes: [{ currency: 'EUR', _sum: { subtotalCents: 25050, platformFeeCents: 1253 } }],
        heldRefunds: [{ currency: 'EUR', _sum: { amountCents: -5000 } }],
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
        heldQuotes: [{ currency: 'USD', _sum: { subtotalCents: 500, platformFeeCents: 25 } }],
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

  it('fails loudly on a negative total instead of reporting it', async () => {
    const { service } = setup({
      groups: {
        heldQuotes: [{ currency: 'EUR', _sum: { subtotalCents: 1000, platformFeeCents: 50 } }],
        heldRefunds: [{ currency: 'EUR', _sum: { amountCents: -990 } }],
      },
    });
    await expect(service.getOwn(PHOTOGRAPHER)).rejects.toThrow(/negative EUR total/);
  });
});
