import { Inject, Injectable } from '@nestjs/common';
import type { LedgerEntryType } from '@photoo/db';
import { PrismaService } from '../../prisma/prisma.service.js';

export interface DashboardRange {
  from: Date;
  to: Date;
}

export const DASHBOARD_SIGNUP_ROLES = ['client', 'photographer', 'professional'] as const;
export type DashboardSignupRole = (typeof DASHBOARD_SIGNUP_ROLES)[number];

export interface SignupCounts {
  total: number;
  client: number;
  photographer: number;
  professional: number;
}

export interface ActivityCounts {
  requests: number;
  quotes: number;
  bookings: number;
}

export interface CurrencyTotal {
  currency: string;
  amountCents: number;
}

export interface BacklogCounts {
  verification: number;
  provenance: number;
  reports: number;
  dataRequests: number;
}

function within(range: DashboardRange) {
  return { gte: range.from, lt: range.to };
}

@Injectable()
export class AdminDashboardRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async countSignups(range: DashboardRange): Promise<SignupCounts> {
    const { user } = this.prisma.client;
    const createdAt = within(range);
    const countRole = (role: DashboardSignupRole) =>
      user.count({ where: { createdAt, roles: { has: role } } });
    const [total, client, photographer, professional] = await Promise.all([
      user.count({ where: { createdAt, roles: { hasSome: [...DASHBOARD_SIGNUP_ROLES] } } }),
      countRole('client'),
      countRole('photographer'),
      countRole('professional'),
    ]);
    return { total, client, photographer, professional };
  }

  async countActivity(range: DashboardRange): Promise<ActivityCounts> {
    const { request, quote, booking } = this.prisma.client;
    const createdAt = within(range);
    const [requests, quotes, bookings] = await Promise.all([
      request.count({ where: { createdAt } }),
      quote.count({ where: { createdAt, status: { not: 'draft' } } }),
      booking.count({ where: { createdAt, status: { notIn: ['pending_payment', 'cancelled'] } } }),
    ]);
    return { requests, quotes, bookings };
  }

  async sumLedger(type: LedgerEntryType, range: DashboardRange): Promise<CurrencyTotal[]> {
    const rows = await this.prisma.client.ledgerEntry.groupBy({
      by: ['currency'],
      where: { type, occurredAt: within(range) },
      _sum: { amountCents: true },
    });
    return rows.map((row) => ({ currency: row.currency, amountCents: row._sum.amountCents ?? 0 }));
  }

  async countBacklogs(): Promise<BacklogCounts> {
    const { verificationCase, provenanceCheck, report, dataRequest } = this.prisma.client;
    const [verification, provenance, reports, dataRequests] = await Promise.all([
      verificationCase.count({ where: { status: { in: ['submitted', 'in_review'] } } }),
      provenanceCheck.count({ where: { portfolioImage: { status: 'pending_review' } } }),
      report.count({ where: { status: 'open' } }),
      dataRequest.count({ where: { status: { in: ['pending', 'processing', 'failed'] } } }),
    ]);
    return { verification, provenance, reports, dataRequests };
  }
}
