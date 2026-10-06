import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@photoo/db';
import { EARNINGS_RECENT_LIMIT, type EarningsResponseSchema } from '@photoo/shared';
import type { z } from 'zod';
import { requireRole } from '../../common/auth/require-role.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { PaymentsRateLimitService } from './payments-rate-limit.service.js';

type EarningsDto = z.infer<typeof EarningsResponseSchema>;
type EarningsTotalDto = EarningsDto['totals'][number];

interface SessionUser {
  id: string;
  roles: string[];
}

const HELD_STATUSES = ['paid_held', 'in_progress', 'delivered', 'disputed'] as const;
const RELEASE_LEDGER_TYPES = ['transfer', 'reversal'] as const;

// A booking can be `disputed` after release (booking-state-machine.ts); its
// money has already been transferred and is counted as released, not held.
function heldBookingWhere(photographerId: string): Prisma.BookingWhereInput {
  return {
    photographerId,
    status: { in: [...HELD_STATUSES] },
    ledgerEntries: { none: { type: 'transfer' } },
  };
}

@Injectable()
export class EarningsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PaymentsRateLimitService) private readonly rateLimit: PaymentsRateLimitService,
  ) {}

  async getOwn(user: SessionUser): Promise<EarningsDto> {
    requireRole(user, 'photographer');
    await this.rateLimit.enforceEarningsRead(user.id);

    const profile = await this.prisma.client.photographerProfile.findUnique({
      where: { userId: user.id },
      select: { id: true },
    });
    if (!profile) {
      return { totals: [], recent: [] };
    }
    const db = this.prisma.client;
    const photographerId = profile.id;

    // Transfer rows are negative and reversal rows positive (booking-ledger.ts),
    // so the photographer's net is the negated sum of both.
    const [released, heldQuotes, heldRefunds, recent] = await Promise.all([
      db.ledgerEntry.groupBy({
        by: ['currency'],
        where: { type: { in: [...RELEASE_LEDGER_TYPES] }, booking: { photographerId } },
        _sum: { amountCents: true },
      }),
      db.quote.groupBy({
        by: ['currency'],
        where: { booking: { is: heldBookingWhere(photographerId) } },
        _sum: { subtotalCents: true, platformFeeCents: true },
      }),
      // A partial refund before release comes out of the photographer's share
      // (BookingReleaseService), so it is not held for them either.
      db.ledgerEntry.groupBy({
        by: ['currency'],
        where: { type: 'refund', booking: heldBookingWhere(photographerId) },
        _sum: { amountCents: true },
      }),
      db.ledgerEntry.groupBy({
        by: ['bookingId', 'currency'],
        where: { type: { in: [...RELEASE_LEDGER_TYPES] }, booking: { photographerId } },
        _sum: { amountCents: true },
        _max: { occurredAt: true },
        orderBy: [{ _max: { occurredAt: 'desc' } }, { bookingId: 'desc' }],
        take: EARNINGS_RECENT_LIMIT,
      }),
    ]);

    const totals = new Map<string, EarningsTotalDto>();
    const totalFor = (currency: string): EarningsTotalDto => {
      const existing = totals.get(currency);
      if (existing) {
        return existing;
      }
      const created = { currency, releasedCents: 0, heldCents: 0 };
      totals.set(currency, created);
      return created;
    };
    for (const group of released) {
      totalFor(group.currency).releasedCents = -(group._sum.amountCents ?? 0);
    }
    for (const group of heldQuotes) {
      totalFor(group.currency).heldCents +=
        (group._sum.subtotalCents ?? 0) - (group._sum.platformFeeCents ?? 0);
    }
    for (const group of heldRefunds) {
      totalFor(group.currency).heldCents += group._sum.amountCents ?? 0;
    }
    for (const total of totals.values()) {
      if (total.releasedCents < 0 || total.heldCents < 0) {
        throw new Error(
          `earnings: photographer ${photographerId} has a negative ${total.currency} total (released ${String(total.releasedCents)}, held ${String(total.heldCents)}); reconcile the ledger`,
        );
      }
    }

    return {
      totals: [...totals.values()].sort((a, b) => a.currency.localeCompare(b.currency)),
      recent: recent.map((group) => {
        const occurredAt = group._max.occurredAt;
        if (!occurredAt) {
          throw new Error(`earnings: booking ${group.bookingId} ledger group has no occurredAt`);
        }
        return {
          bookingId: group.bookingId,
          amountCents: -(group._sum.amountCents ?? 0),
          currency: group.currency,
          occurredAt: occurredAt.toISOString(),
        };
      }),
    };
  }
}
