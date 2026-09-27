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

  async function storeUnhandledEvent(id: string, receivedAt: Date): Promise<void> {
    eventIds.push(id);
    await prisma.stripeEvent.create({
      data: {
        id,
        type: 'customer.created',
        receivedAt,
        payload: {
          id,
          type: 'customer.created',
          livemode: false,
          data: { object: { id: `cus_${id}`, object: 'customer' } },
        },
      },
    });
  }

  async function processedAt(id: string): Promise<Date | null> {
    const stored = await prisma.stripeEvent.findUniqueOrThrow({ where: { id } });
    return stored.processedAt;
  }

  it('excludes an event exactly at the minimum age and includes one a millisecond older', async () => {
    const now = new Date();
    const atBoundary = `evt_sweep_min_${randomUUID()}`;
    const justOlder = `evt_sweep_min_older_${randomUUID()}`;
    await storeUnhandledEvent(atBoundary, new Date(now.getTime() - STUCK_EVENT_MIN_AGE_MS));
    await storeUnhandledEvent(justOlder, new Date(now.getTime() - STUCK_EVENT_MIN_AGE_MS - 1));

    await app.get(StripeEventSweepService).sweep(now);

    expect(await processedAt(atBoundary)).toBeNull();
    expect(await processedAt(justOlder)).not.toBeNull();
  });

  it('excludes an event exactly at the maximum age and includes one a millisecond younger', async () => {
    const now = new Date();
    const atBoundary = `evt_sweep_max_${randomUUID()}`;
    const justYounger = `evt_sweep_max_younger_${randomUUID()}`;
    await storeUnhandledEvent(atBoundary, new Date(now.getTime() - STUCK_EVENT_MAX_AGE_MS));
    await storeUnhandledEvent(justYounger, new Date(now.getTime() - STUCK_EVENT_MAX_AGE_MS + 1));

    await app.get(StripeEventSweepService).sweep(now);

    expect(await processedAt(atBoundary)).toBeNull();
    expect(await processedAt(justYounger)).not.toBeNull();
  });
});
