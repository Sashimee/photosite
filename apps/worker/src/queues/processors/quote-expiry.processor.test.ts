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
  id: '018f2e1a-0000-7000-8000-000000000001',
  requestId: '018f2e1a-0000-7000-8000-000000000002',
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
  const quoteUpdateManyAndReturn = vi.fn(() => Promise.resolve(expiring));
  const requestUpdateMany = vi.fn(() => Promise.resolve({ count: overrides.requestCount ?? 0 }));
  const requestFindUnique = vi.fn(() => Promise.resolve({ title: 'Fixture Request' }));
  const photographerProfileFindUnique = vi.fn(() =>
    Promise.resolve({ userId: 'photographer-user-1', displayName: 'Fixture Photographer' }),
  );
  let notificationCounter = 0;
  const notificationCreate = vi.fn<
    (args: { data: Record<string, unknown> }) => Promise<{ id: string }>
  >(() => {
    notificationCounter += 1;
    return Promise.resolve({ id: `notification-${String(notificationCounter)}` });
  });
  const notificationPreferenceFindMany = vi.fn(() => Promise.resolve([]));

  const tx: QuoteExpiryTransactionClient = {
    quote: { updateManyAndReturn: quoteUpdateManyAndReturn },
    request: { updateMany: requestUpdateMany, findUnique: requestFindUnique },
    photographerProfile: { findUnique: photographerProfileFindUnique },
    auditLog: { create: auditLogCreate },
    notification: { create: notificationCreate },
    notificationPreference: { findMany: notificationPreferenceFindMany },
  };

  const notifyQueueAdd = vi.fn<(name: string, data: unknown, opts?: object) => Promise<void>>(() =>
    Promise.resolve(),
  );

  const d: QuoteExpiryDeps = {
    prisma: { client: { $transaction: (fn) => fn(tx) } },
    notifyQueue: { add: notifyQueueAdd },
    logger: fakeLogger(),
  };

  return {
    deps: d,
    tx,
    auditLogCreate,
    quoteUpdateManyAndReturn,
    requestUpdateMany,
    requestFindUnique,
    photographerProfileFindUnique,
    notificationCreate,
    notifyQueueAdd,
  };
}

describe('createQuoteExpiryProcessor', () => {
  it('closes open/quoted requests past expiresAt and expires sent quotes past validUntil, in one atomic update', async () => {
    const {
      deps: d,
      quoteUpdateManyAndReturn,
      requestUpdateMany,
    } = deps({
      expiring: [FIXTURE_QUOTE],
      requestCount: 1,
    });

    await createQuoteExpiryProcessor(d)(FAKE_JOB, undefined, undefined);

    expect(requestUpdateMany).toHaveBeenCalledWith({
      where: {
        status: { in: ['open', 'quoted'] },
        expiresAt: { lt: expect.any(Date) as Date },
        deletedAt: null,
      },
      data: { status: 'closed' },
    });
    expect(quoteUpdateManyAndReturn).toHaveBeenCalledWith({
      where: {
        status: 'sent',
        OR: [
          { validUntil: { lt: expect.any(Date) as Date } },
          { request: { status: { in: ['closed', 'cancelled'] } } },
        ],
      },
      data: { status: 'expired' },
    });
  });

  it('keeps the status: sent guard in the same atomic query, so a quote accepted concurrently is never expired or notified', async () => {
    const { deps: d, notificationCreate } = deps({ expiring: [] });

    await createQuoteExpiryProcessor(d)(FAKE_JOB, undefined, undefined);

    expect(notificationCreate).not.toHaveBeenCalled();
  });

  it('runs the request close before the quote update, in the same transaction', async () => {
    const order: string[] = [];
    const requestUpdateMany = vi.fn(() => {
      order.push('request');
      return Promise.resolve({ count: 0 });
    });
    const quoteUpdateManyAndReturn = vi.fn(() => {
      order.push('quote');
      return Promise.resolve([]);
    });
    const { deps: base, tx } = deps();
    const patchedTx: QuoteExpiryTransactionClient = {
      ...tx,
      quote: { updateManyAndReturn: quoteUpdateManyAndReturn },
      request: { ...tx.request, updateMany: requestUpdateMany },
    };
    const d: QuoteExpiryDeps = {
      ...base,
      prisma: { client: { $transaction: (fn) => fn(patchedTx) } },
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

  it('inserts a quote_expired notification row for the client and the photographer, then enqueues each after the transaction', async () => {
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

  it('omits counterpartName from the photographer copy (S6: never the client User.name)', async () => {
    const { deps: d, notificationCreate } = deps({ expiring: [FIXTURE_QUOTE] });

    await createQuoteExpiryProcessor(d)(FAKE_JOB, undefined, undefined);

    const photographerCall = notificationCreate.mock.calls.find(
      (call) => call[0].data.userId === 'photographer-user-1',
    );
    const payload = photographerCall?.[0].data.payload as { counterpartName?: string };
    expect(payload.counterpartName).toBeUndefined();
  });

  it('does not fail the sweep when a notify enqueue fails', async () => {
    const { deps: d, notifyQueueAdd } = deps({ expiring: [FIXTURE_QUOTE] });
    notifyQueueAdd.mockRejectedValueOnce(new Error('redis down'));

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
