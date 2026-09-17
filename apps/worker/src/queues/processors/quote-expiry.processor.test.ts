import type { Job } from 'bullmq';
import type { Logger } from 'nestjs-pino';
import { describe, expect, it, vi } from 'vitest';
import {
  createQuoteExpiryProcessor,
  type QuoteExpiryDeps,
  type QuoteExpiryTransactionClient,
} from './quote-expiry.processor.js';

const FAKE_JOB = {} as Job;

function fakeLogger(): Logger {
  return { log: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger;
}

function deps(overrides: { quoteCount?: number; requestCount?: number }) {
  const auditLogCreate = vi.fn(() => Promise.resolve());
  const quoteUpdateMany = vi.fn(() => Promise.resolve({ count: overrides.quoteCount ?? 0 }));
  const requestUpdateMany = vi.fn(() => Promise.resolve({ count: overrides.requestCount ?? 0 }));
  const tx: QuoteExpiryTransactionClient = {
    quote: { updateMany: quoteUpdateMany },
    request: { updateMany: requestUpdateMany },
    auditLog: { create: auditLogCreate },
  };
  const deps: QuoteExpiryDeps = {
    prisma: {
      client: { $transaction: (fn) => fn(tx) },
    },
    logger: fakeLogger(),
  };
  return { deps, auditLogCreate, quoteUpdateMany, requestUpdateMany };
}

describe('createQuoteExpiryProcessor', () => {
  it('closes open/quoted requests past expiresAt and expires sent quotes past validUntil', async () => {
    const {
      deps: d,
      quoteUpdateMany,
      requestUpdateMany,
    } = deps({
      quoteCount: 2,
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
    expect(quoteUpdateMany).toHaveBeenCalledWith({
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

  it('runs the request close before the quote expiry, in the same transaction', async () => {
    const order: string[] = [];
    const requestUpdateMany = vi.fn(() => {
      order.push('request');
      return Promise.resolve({ count: 0 });
    });
    const quoteUpdateMany = vi.fn(() => {
      order.push('quote');
      return Promise.resolve({ count: 0 });
    });
    const tx: QuoteExpiryTransactionClient = {
      quote: { updateMany: quoteUpdateMany },
      request: { updateMany: requestUpdateMany },
      auditLog: { create: vi.fn(() => Promise.resolve()) },
    };
    const d: QuoteExpiryDeps = {
      prisma: { client: { $transaction: (fn) => fn(tx) } },
      logger: fakeLogger(),
    };

    await createQuoteExpiryProcessor(d)(FAKE_JOB, undefined, undefined);

    expect(order).toEqual(['request', 'quote']);
  });

  it('writes one audit log row with counts when something changed', async () => {
    const { deps: d, auditLogCreate } = deps({ quoteCount: 3, requestCount: 2 });

    await createQuoteExpiryProcessor(d)(FAKE_JOB, undefined, undefined);

    expect(auditLogCreate).toHaveBeenCalledWith({
      data: {
        actorType: 'system',
        actorId: null,
        action: 'quote_expiry.swept',
        targetType: 'System',
        targetId: null,
        after: { expiredQuotes: 3, closedRequests: 2 },
      },
    });
  });

  it('writes no audit log row when nothing changed (idempotent re-run)', async () => {
    const { deps: d, auditLogCreate } = deps({ quoteCount: 0, requestCount: 0 });

    await createQuoteExpiryProcessor(d)(FAKE_JOB, undefined, undefined);

    expect(auditLogCreate).not.toHaveBeenCalled();
  });

  it('writes an audit log row when only quotes changed', async () => {
    const { deps: d, auditLogCreate } = deps({ quoteCount: 1, requestCount: 0 });

    await createQuoteExpiryProcessor(d)(FAKE_JOB, undefined, undefined);

    expect(auditLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          after: { expiredQuotes: 1, closedRequests: 0 },
        }) as unknown,
      }) as unknown,
    );
  });

  it('writes an audit log row when only requests changed', async () => {
    const { deps: d, auditLogCreate } = deps({ quoteCount: 0, requestCount: 1 });

    await createQuoteExpiryProcessor(d)(FAKE_JOB, undefined, undefined);

    expect(auditLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          after: { expiredQuotes: 0, closedRequests: 1 },
        }) as unknown,
      }) as unknown,
    );
  });
});
