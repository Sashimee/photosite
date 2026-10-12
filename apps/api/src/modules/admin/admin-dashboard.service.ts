import { Inject, Injectable } from '@nestjs/common';
import type { AdminDashboardQuerySchema, AdminDashboardSchema } from '@photoo/shared';
import type { z } from 'zod';
import { forbidden } from '../../common/auth/require-admin.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  AdminDashboardRepository,
  type CurrencyTotal,
  type DashboardRange,
} from './admin-dashboard.repository.js';

type Query = z.infer<typeof AdminDashboardQuerySchema>;
type DashboardDto = z.infer<typeof AdminDashboardSchema>;
interface WindowedCount {
  current: number;
  previous: number;
}
type WindowedMoney = NonNullable<DashboardDto['money']>['gmv'];

const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_DAYS: Record<Query['window'], number> = { '7d': 7, '30d': 30, '90d': 90 };

function pair(current: number, previous: number): WindowedCount {
  return { current, previous };
}

// The ledger stores refunds and fees as negative amounts; the dashboard
// reports magnitudes so a card never shows "-€12.00 refunded".
function mergeMoney(
  current: CurrencyTotal[],
  previous: CurrencyTotal[],
  negate: boolean,
): WindowedMoney {
  const sign = negate ? -1 : 1;
  const byCurrency = new Map<string, WindowedCount>();
  for (const row of current) {
    byCurrency.set(row.currency, { current: sign * row.amountCents, previous: 0 });
  }
  for (const row of previous) {
    const entry = byCurrency.get(row.currency) ?? { current: 0, previous: 0 };
    entry.previous = sign * row.amountCents;
    byCurrency.set(row.currency, entry);
  }
  return [...byCurrency.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, values]) => ({ currency, ...values }));
}

@Injectable()
export class AdminDashboardService {
  constructor(
    @Inject(AdminDashboardRepository) private readonly repository: AdminDashboardRepository,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  async get(userId: string, query: Query, now: Date = new Date()): Promise<DashboardDto> {
    const grants = await this.prisma.client.adminPermissionGrant.findMany({
      where: { userId },
      select: { permission: true },
    });
    if (grants.length === 0) {
      throw forbidden('At least one admin permission is required');
    }
    const canSeeMoney = grants.some(
      ({ permission }) => permission === 'finance' || permission === 'superadmin',
    );

    const spanMs = WINDOW_DAYS[query.window] * DAY_MS;
    const current: DashboardRange = { from: new Date(now.getTime() - spanMs), to: now };
    const previous: DashboardRange = {
      from: new Date(now.getTime() - 2 * spanMs),
      to: current.from,
    };

    const [signupsNow, signupsBefore, activityNow, activityBefore, backlogs, money] =
      await Promise.all([
        this.repository.countSignups(current),
        this.repository.countSignups(previous),
        this.repository.countActivity(current),
        this.repository.countActivity(previous),
        this.repository.countBacklogs(),
        canSeeMoney ? this.loadMoney(current, previous) : Promise.resolve(null),
      ]);

    return {
      window: query.window,
      generatedAt: now.toISOString(),
      signups: {
        total: pair(signupsNow.total, signupsBefore.total),
        client: pair(signupsNow.client, signupsBefore.client),
        photographer: pair(signupsNow.photographer, signupsBefore.photographer),
        professional: pair(signupsNow.professional, signupsBefore.professional),
      },
      activity: {
        requests: pair(activityNow.requests, activityBefore.requests),
        quotes: pair(activityNow.quotes, activityBefore.quotes),
        bookings: pair(activityNow.bookings, activityBefore.bookings),
      },
      money,
      backlogs,
    };
  }

  private async loadMoney(current: DashboardRange, previous: DashboardRange) {
    const [charges, chargesBefore, refunds, refundsBefore, fees, feesBefore] = await Promise.all([
      this.repository.sumLedger('charge', current),
      this.repository.sumLedger('charge', previous),
      this.repository.sumLedger('refund', current),
      this.repository.sumLedger('refund', previous),
      this.repository.sumLedger('platform_fee', current),
      this.repository.sumLedger('platform_fee', previous),
    ]);
    return {
      gmv: mergeMoney(charges, chargesBefore, false),
      refunds: mergeMoney(refunds, refundsBefore, true),
      feeRevenue: mergeMoney(fees, feesBefore, true),
    };
  }
}
