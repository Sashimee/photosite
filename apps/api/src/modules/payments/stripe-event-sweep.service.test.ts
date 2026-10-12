import type { Logger } from 'nestjs-pino';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { TEST_ENV } from '../../testing/test-env.js';
import {
  STUCK_EVENT_MAX_AGE_MS,
  STUCK_EVENT_MIN_AGE_MS,
  StripeEventSweepService,
} from './stripe-event-sweep.service.js';
import type { ReprocessResult, StripeWebhookService } from './stripe-webhook.service.js';

function setup(results: Record<string, ReprocessResult | Error>) {
  const findMany = vi.fn(() =>
    Promise.resolve(Object.keys(results).map((id) => ({ id, type: 'payment_intent.succeeded' }))),
  );
  const prisma = { client: { stripeEvent: { findMany } } } as unknown as PrismaService;
  const reprocess = vi.fn((id: string) => {
    const result = results[id];
    return result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
  });
  const logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const service = new StripeEventSweepService(
    prisma,
    { reprocess } as unknown as StripeWebhookService,
    TEST_ENV,
    logger as unknown as Logger,
  );
  return { service, findMany, reprocess, logger };
}

describe('StripeEventSweepService.sweep', () => {
  it('picks unprocessed handled events inside the retry window and stored dispute events of any age, oldest first', async () => {
    const { service, findMany } = setup({});
    const now = new Date('2026-09-27T12:00:00Z');

    await service.sweep(now);

    expect(findMany).toHaveBeenCalledWith({
      where: {
        processedAt: null,
        receivedAt: { lt: new Date(now.getTime() - STUCK_EVENT_MIN_AGE_MS) },
        OR: [
          {
            type: {
              in: [
                'payment_intent.succeeded',
                'payment_intent.payment_failed',
                'account.updated',
                'charge.refunded',
                'transfer.reversed',
                'charge.dispute.created',
                'charge.dispute.closed',
              ],
            },
            receivedAt: { gt: new Date(now.getTime() - STUCK_EVENT_MAX_AGE_MS) },
          },
          { type: { in: ['charge.dispute.created', 'charge.dispute.closed'] } },
        ],
      },
      orderBy: { receivedAt: 'asc' },
      take: 100,
      select: { id: true, type: true },
    });
  });

  it('counts each outcome and keeps going after a failure', async () => {
    const { service, reprocess, logger } = setup({
      evt_a: 'processed',
      evt_b: new Error('boom'),
      evt_c: 'deferred',
      evt_d: 'skipped',
    });

    const result = await service.sweep();

    expect(result).toEqual({ attempted: 4, processed: 1, deferred: 1, failed: 1 });
    expect(reprocess).toHaveBeenCalledTimes(4);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ stripeEventId: 'evt_b' }),
      expect.any(String),
    );
  });

  it('does not schedule itself when the interval is 0', () => {
    const { service } = setup({});
    const spy = vi.spyOn(globalThis, 'setInterval');

    service.onApplicationBootstrap();

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
