import { randomUUID } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createPrismaClient, type PrismaClient } from '@photoo/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../../testing/create-test-app.js';
import { requireIntegrationEnv } from '../../testing/require-integration-env.js';
import { TEST_ENV } from '../../testing/test-env.js';
import {
  STUCK_EVENT_MAX_AGE_MS,
  STUCK_EVENT_MIN_AGE_MS,
  StripeEventSweepService,
} from './stripe-event-sweep.service.js';

const testEnv = requireIntegrationEnv(['TEST_DATABASE_URL', 'REDIS_URL']);

describe('stripe event sweep age window integration', () => {
  if (!testEnv) {
    it.skip('skipped: TEST_DATABASE_URL or REDIS_URL is not set', () => undefined);
    return;
  }

  let app: NestFastifyApplication;
  let prisma: PrismaClient;
  const eventIds: string[] = [];

  beforeAll(async () => {
    app = await createTestApp({
      ...TEST_ENV,
      DATABASE_URL: testEnv.TEST_DATABASE_URL,
      REDIS_URL: testEnv.REDIS_URL,
    });
    prisma = createPrismaClient(testEnv.TEST_DATABASE_URL);
  });

  afterAll(async () => {
    await prisma.stripeEvent.deleteMany({ where: { id: { in: eventIds } } });
    await prisma.$disconnect();
    await app.close();
  });

  async function storeEvent(id: string, receivedAt: Date, type: string, account?: string) {
    eventIds.push(id);
    await prisma.stripeEvent.create({
      data: {
        id,
        type,
        receivedAt,
        payload: {
          id,
          type,
          livemode: false,
          ...(account === undefined ? {} : { account }),
          data: { object: { id: `pi_${id}`, object: 'payment_intent' } },
        },
      },
    });
  }

  async function storeConnectedAccountEvent(id: string, receivedAt: Date): Promise<void> {
    await storeEvent(id, receivedAt, 'payment_intent.payment_failed', 'acct_sweep');
  }

  async function processedAt(id: string): Promise<Date | null> {
    const stored = await prisma.stripeEvent.findUniqueOrThrow({ where: { id } });
    return stored.processedAt;
  }

  it('excludes an event exactly at the minimum age and includes one a millisecond older', async () => {
    const now = new Date();
    const atBoundary = `evt_sweep_min_${randomUUID()}`;
    const justOlder = `evt_sweep_min_older_${randomUUID()}`;
    await storeConnectedAccountEvent(atBoundary, new Date(now.getTime() - STUCK_EVENT_MIN_AGE_MS));
    await storeConnectedAccountEvent(
      justOlder,
      new Date(now.getTime() - STUCK_EVENT_MIN_AGE_MS - 1),
    );

    await app.get(StripeEventSweepService).sweep(now);

    expect(await processedAt(atBoundary)).toBeNull();
    expect(await processedAt(justOlder)).not.toBeNull();
  });

  it('excludes an event exactly at the maximum age and includes one a millisecond younger', async () => {
    const now = new Date();
    const atBoundary = `evt_sweep_max_${randomUUID()}`;
    const justYounger = `evt_sweep_max_younger_${randomUUID()}`;
    await storeConnectedAccountEvent(atBoundary, new Date(now.getTime() - STUCK_EVENT_MAX_AGE_MS));
    await storeConnectedAccountEvent(
      justYounger,
      new Date(now.getTime() - STUCK_EVENT_MAX_AGE_MS + 1),
    );

    await app.get(StripeEventSweepService).sweep(now);

    expect(await processedAt(atBoundary)).toBeNull();
    expect(await processedAt(justYounger)).not.toBeNull();
  });

  it('never picks up an event type the webhook does not handle', async () => {
    const now = new Date();
    const unhandled = `evt_sweep_unhandled_${randomUUID()}`;
    await storeEvent(
      unhandled,
      new Date(now.getTime() - STUCK_EVENT_MIN_AGE_MS - 1),
      'customer.created',
    );

    await app.get(StripeEventSweepService).sweep(now);

    expect(await processedAt(unhandled)).toBeNull();
  });
});
