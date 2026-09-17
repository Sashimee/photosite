import type { Job } from 'bullmq';
import type { Logger } from 'nestjs-pino';
import { describe, expect, it, vi } from 'vitest';
import {
  createQuoteExpiryProcessor,
  type ExpiredQuoteRow,
  type QuoteExpiryDeps,
  type QuoteExpiryTransactionClient,
} from './quote-expiry.processor.js';

const FAKE_JOB = {} as Job;

const FIXTURE_QUOTE: ExpiredQuoteRow = {
  id: 'quote-1',
  requestId: 'request-1',
  photographerId: 'profile-1',
  clientId: 'client-1',
  totalCents: 50000,
  currency: 'EUR',
};

function fakeLogger(): Logger {
  return { log: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger;
}

function deps(overrides: { expiring?: ExpiredQuoteRow[]; requestCount?: number } = {}) {
  const expiring = overrides.expiring ?? [];
  const auditLogCreate = vi.fn(() => Promise.resolve());
  const quoteFindMany = vi.fn(() => Promise.resolve(expiring));
  const quoteUpdateMany = vi.fn(() => Promise.resolve({ count: expiring.length }));
  const requestUpdateMany = vi.fn(() => Promise.resolve({ count: overrides.requestCount ?? 0 }));
  const tx: QuoteExpiryTransactionClient = {
    quote: { findMany: quoteFindMany, updateMany: quoteUpdateMany },
    request: { updateMany: requestUpdateMany },
    auditLog: { create: auditLogCreate },
  };

  const notificationCreate = vi.fn<
    (args: { data: Record<string, unknown> }) => Promise<{ id: string }>
  >(() => Promise.resolve({ id: 'notification-1' }));
  const notificationPreferenceFindMany = vi.fn(() => Promise.resolve([]));
  const notifyQueueAdd = vi.fn<
    (name: string, data: unknown, opts?: Record<string, unknown>) => Promise<void>
  >(() => Promise.resolve());

  const photographerProfileFindUnique = vi.fn(() =>
    Promise.resolve({ userId: 'photographer-user-1', displayName: 'Fixture Photographer' }),
  );
  const userFindUnique = vi.fn(() => Promise.resolve({ name: 'Fixture Client' }));
  const requestFindUnique = vi.fn(() => Promise.resolve({ title: 'Fixture Request' }));

  const d: QuoteExpiryDeps = {
    prisma: {
      client: {
        $transaction: (fn) => fn(tx),
        photographerProfile: { findUnique: photographerProfileFindUnique },
        user: { findUnique: userFindUnique },
        request: { findUnique: requestFindUnique },
      },
    },
    notify: {
      prisma: {
        client: {
          notification: { create: notificationCreate },
          notificationPreference: { findMany: notificationPreferenceFindMany },
        },
      },
      notifyQueue: { add: notifyQueueAdd },
    },
    logger: fakeLogger(),
  };

  return {
    deps: d,
    auditLogCreate,
    quoteFindMany,
    quoteUpdateMany,
    requestUpdateMany,
    notificationCreate,
    notifyQueueAdd,
    photographerProfileFindUnique,
    userFindUnique,
    requestFindUnique,
  };
}

describe('createQuoteExpiryProcessor', () => {
  it('closes open/quoted requests past expiresAt and expires sent quotes past validUntil', async () => {
    const {
      deps: d,
      quoteFindMany,
      quoteUpdateMany,
      requestUpdateMany,
    } = deps({ expiring: [FIXTURE_QUOTE], requestCount: 1 });

    await createQuoteExpiryProcessor(d)(FAKE_JOB, undefined, undefined);

    expect(requestUpdateMany).toHaveBeenCalledWith({
      where: {
        status: { in: ['open', 'quoted'] },
        expiresAt: { lt: expect.any(Date) as Date },
        deletedAt: null,
      },
      data: { status: 'closed' },
    });
    expect(quoteFindMany).toHaveBeenCalledWith({
      where: {
        status: 'sent',
        OR: [
          { validUntil: { lt: expect.any(Date) as Date } },
          { request: { status: { in: ['closed', 'cancelled'] } } },
        ],
      },
    });
    expect(quoteUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: [FIXTURE_QUOTE.id] } },
      data: { status: 'expired' },
    });
  });

  it('skips the quote update entirely when nothing is expiring', async () => {
    const { deps: d, quoteUpdateMany } = deps({ expiring: [] });

    await createQuoteExpiryProcessor(d)(FAKE_JOB, undefined, undefined);

    expect(quoteUpdateMany).not.toHaveBeenCalled();
  });

  it('runs the request close before the quote lookup, in the same transaction', async () => {
    const order: string[] = [];
    const requestUpdateMany = vi.fn(() => {
      order.push('request');
      return Promise.resolve({ count: 0 });
    });
    const quoteFindMany = vi.fn(() => {
      order.push('quote');
      return Promise.resolve([]);
    });
    const tx: QuoteExpiryTransactionClient = {
      quote: { findMany: quoteFindMany, updateMany: vi.fn(() => Promise.resolve({ count: 0 })) },
      request: { updateMany: requestUpdateMany },
      auditLog: { create: vi.fn(() => Promise.resolve()) },
    };
    const { deps: base } = deps();
    const d: QuoteExpiryDeps = {
      ...base,
      prisma: { client: { ...base.prisma.client, $transaction: (fn) => fn(tx) } },
    };

    await createQuoteExpiryProcessor(d)(FAKE_JOB, undefined, undefined);

    expect(order).toEqual(['request', 'quote']);
  });

  it('writes one audit log row with counts when something changed', async () => {
    const { deps: d, auditLogCreate } = deps({ expiring: [FIXTURE_QUOTE], requestCount: 2 });

    await createQuoteExpiryProcessor(d)(FAKE_JOB, undefined, undefined);

    expect(auditLogCreate).toHaveBeenCalledWith({
      data: {
        actorType: 'system',
        actorId: null,
        action: 'quote_expiry.swept',
        targetType: 'System',
        targetId: null,
        after: { expiredQuotes: 1, closedRequests: 2 },
      },
    });
  });

  it('writes no audit log row when nothing changed (idempotent re-run)', async () => {
    const { deps: d, auditLogCreate } = deps();

    await createQuoteExpiryProcessor(d)(FAKE_JOB, undefined, undefined);

    expect(auditLogCreate).not.toHaveBeenCalled();
  });

  it('creates a quote_expired notification for the client and the photographer', async () => {
    const { deps: d, notificationCreate, notifyQueueAdd } = deps({ expiring: [FIXTURE_QUOTE] });

    await createQuoteExpiryProcessor(d)(FAKE_JOB, undefined, undefined);

    expect(notificationCreate).toHaveBeenCalledTimes(2);
    const userIds = notificationCreate.mock.calls.map((call) => call[0].data.userId as string);
    expect(userIds.sort()).toEqual(['client-1', 'photographer-user-1'].sort());
    for (const call of notificationCreate.mock.calls) {
      expect(call[0].data.type).toBe('quote_expired');
      expect(call[0].data.payload).toMatchObject({ quoteId: FIXTURE_QUOTE.id });
    }
    expect(notifyQueueAdd).toHaveBeenCalledTimes(2);
  });

  it('does not fail the sweep when notification creation throws', async () => {
    const { deps: d, notificationCreate } = deps({ expiring: [FIXTURE_QUOTE] });
    notificationCreate.mockRejectedValueOnce(new Error('db down'));

    await expect(
      createQuoteExpiryProcessor(d)(FAKE_JOB, undefined, undefined),
    ).resolves.toBeUndefined();
  });

  it('creates no notifications when nothing expired', async () => {
    const { deps: d, notificationCreate } = deps();

    await createQuoteExpiryProcessor(d)(FAKE_JOB, undefined, undefined);

    expect(notificationCreate).not.toHaveBeenCalled();
  });
});
