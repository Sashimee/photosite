import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type {
  AdminDashboardRepository,
  CurrencyTotal,
  DashboardRange,
} from './admin-dashboard.repository.js';
import { AdminDashboardService } from './admin-dashboard.service.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-10-07T12:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

const ZERO_SIGNUPS = { total: 0, client: 0, photographer: 0, professional: 0 };
const ZERO_ACTIVITY = { requests: 0, quotes: 0, bookings: 0 };
const ZERO_BACKLOGS = { verification: 0, provenance: 0, reports: 0, dataRequests: 0 };

interface Overrides {
  permissions?: string[];
  signups?: (range: DashboardRange) => typeof ZERO_SIGNUPS;
  activity?: (range: DashboardRange) => typeof ZERO_ACTIVITY;
  ledger?: (type: string, range: DashboardRange) => CurrencyTotal[];
}

function buildService(overrides: Overrides = {}) {
  const countSignups = vi.fn((range: DashboardRange) =>
    Promise.resolve((overrides.signups ?? (() => ZERO_SIGNUPS))(range)),
  );
  const countActivity = vi.fn((range: DashboardRange) =>
    Promise.resolve((overrides.activity ?? (() => ZERO_ACTIVITY))(range)),
  );
  const sumLedger = vi.fn((type: string, range: DashboardRange) =>
    Promise.resolve((overrides.ledger ?? (() => []))(type, range)),
  );
  const countBacklogs = vi.fn(() => Promise.resolve(ZERO_BACKLOGS));
  const findMany = vi.fn(() =>
    Promise.resolve((overrides.permissions ?? ['finance']).map((permission) => ({ permission }))),
  );

  const repository = {
    countSignups,
    countActivity,
    sumLedger,
    countBacklogs,
  } as unknown as AdminDashboardRepository;
  const prisma = {
    client: { adminPermissionGrant: { findMany } },
  } as unknown as PrismaService;

  return {
    service: new AdminDashboardService(repository, prisma),
    countSignups,
    sumLedger,
    countBacklogs,
  };
}

function isCurrent(range: DashboardRange): boolean {
  return range.to.getTime() === NOW.getTime();
}

describe('AdminDashboardService', () => {
  it('rejects an admin with no permission grant', async () => {
    const { service, countBacklogs } = buildService({ permissions: [] });

    await expect(service.get(USER_ID, { window: '30d' }, NOW)).rejects.toMatchObject({
      status: 403,
    });
    expect(countBacklogs).not.toHaveBeenCalled();
  });

  it.each([
    ['7d', 7],
    ['30d', 30],
    ['90d', 90],
  ] as const)(
    'splits %s into a current and an adjoining previous window of equal length',
    async (window, days) => {
      const { service, countSignups } = buildService();

      const result = await service.get(USER_ID, { window }, NOW);

      const ranges = countSignups.mock.calls.map(([range]) => range);
      const current = ranges.find(isCurrent);
      const previous = ranges.find((range) => !isCurrent(range));
      expect(result.window).toBe(window);
      expect(result.generatedAt).toBe(NOW.toISOString());
      expect(current).toEqual({ from: new Date(NOW.getTime() - days * DAY_MS), to: NOW });
      expect(previous).toEqual({
        from: new Date(NOW.getTime() - 2 * days * DAY_MS),
        to: current?.from,
      });
    },
  );

  it('pairs each windowed metric with its previous-window value', async () => {
    const { service } = buildService({
      signups: (range) =>
        isCurrent(range)
          ? { total: 5, client: 3, photographer: 2, professional: 1 }
          : { total: 4, client: 1, photographer: 2, professional: 0 },
      activity: (range) =>
        isCurrent(range)
          ? { requests: 9, quotes: 7, bookings: 2 }
          : { requests: 0, quotes: 3, bookings: 1 },
    });

    const result = await service.get(USER_ID, { window: '30d' }, NOW);

    expect(result.signups).toEqual({
      total: { current: 5, previous: 4 },
      client: { current: 3, previous: 1 },
      photographer: { current: 2, previous: 2 },
      professional: { current: 1, previous: 0 },
    });
    expect(result.activity).toEqual({
      requests: { current: 9, previous: 0 },
      quotes: { current: 7, previous: 3 },
      bookings: { current: 2, previous: 1 },
    });
  });

  it('returns zeros, not nulls, on an empty database', async () => {
    const { service } = buildService();

    const result = await service.get(USER_ID, { window: '30d' }, NOW);

    expect(result.signups.total).toEqual({ current: 0, previous: 0 });
    expect(result.activity.bookings).toEqual({ current: 0, previous: 0 });
    expect(result.backlogs).toEqual(ZERO_BACKLOGS);
    expect(result.money).toEqual({ gmv: [], refunds: [], feeRevenue: [] });
  });

  it.each([['moderation'], ['support'], ['verification']])(
    'returns money null for a %s-only admin and never queries the ledger',
    async (permission) => {
      const { service, sumLedger } = buildService({ permissions: [permission] });

      const result = await service.get(USER_ID, { window: '30d' }, NOW);

      expect(result.money).toBeNull();
      expect(sumLedger).not.toHaveBeenCalled();
    },
  );

  it.each([['finance'], ['superadmin']])('includes money for %s', async (permission) => {
    const { service } = buildService({ permissions: [permission] });

    const result = await service.get(USER_ID, { window: '30d' }, NOW);

    expect(result.money).not.toBeNull();
  });

  it('keeps currencies separate and reports refunds and fees as positive magnitudes', async () => {
    const { service } = buildService({
      permissions: ['moderation', 'finance'],
      ledger: (type, range) => {
        const current = isCurrent(range);
        if (type === 'charge') {
          return current
            ? [
                { currency: 'EUR', amountCents: 10000 },
                { currency: 'USD', amountCents: 2500 },
              ]
            : [{ currency: 'EUR', amountCents: 4000 }];
        }
        if (type === 'refund') {
          return current ? [] : [{ currency: 'USD', amountCents: -500 }];
        }
        return current ? [{ currency: 'EUR', amountCents: -500 }] : [];
      },
    });

    const result = await service.get(USER_ID, { window: '30d' }, NOW);

    expect(result.money).toEqual({
      gmv: [
        { currency: 'EUR', current: 10000, previous: 4000 },
        { currency: 'USD', current: 2500, previous: 0 },
      ],
      refunds: [{ currency: 'USD', current: 0, previous: 500 }],
      feeRevenue: [{ currency: 'EUR', current: 500, previous: 0 }],
    });
  });
});
