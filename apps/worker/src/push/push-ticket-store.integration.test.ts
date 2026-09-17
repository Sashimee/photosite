import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { afterEach, describe, expect, it } from 'vitest';
import { requireIntegrationEnv } from '../testing/require-integration-env.js';
import { createRedisPushTicketStore } from './push-ticket-store.js';

const testEnv = requireIntegrationEnv(['REDIS_URL']);

describe('createRedisPushTicketStore against a real Redis', () => {
  if (!testEnv) {
    it.skip('skipped: REDIS_URL is not set', () => undefined);
    return;
  }

  let redis: Redis | undefined;

  afterEach(async () => {
    if (redis) {
      await redis.del('notify:push-tickets');
      redis.disconnect();
      redis = undefined;
    }
  });

  it('does not surface a ticket before it is due', async () => {
    redis = new Redis(testEnv.REDIS_URL);
    const store = createRedisPushTicketStore(redis);
    const ticketId = `ticket-${randomUUID()}`;

    await store.store(ticketId, 'device-1');

    const due = await store.takeDue(15 * 60 * 1000);
    expect(due.find((entry) => entry.ticketId === ticketId)).toBeUndefined();
  });

  it('surfaces a ticket once it is older than the threshold, then forgets it after clear', async () => {
    redis = new Redis(testEnv.REDIS_URL);
    const store = createRedisPushTicketStore(redis);
    const ticketId = `ticket-${randomUUID()}`;
    const storedAt = Date.now() - 20 * 60 * 1000;

    await store.store(ticketId, 'device-1');
    await redis.zadd('notify:push-tickets', storedAt, ticketId);

    const due = await store.takeDue(15 * 60 * 1000);
    expect(due).toContainEqual({ ticketId, deviceId: 'device-1' });

    await store.clear([ticketId]);

    const afterClear = await store.takeDue(0);
    expect(afterClear.find((entry) => entry.ticketId === ticketId)).toBeUndefined();
    expect(await redis.get(`notify:push-ticket:${ticketId}`)).toBeNull();
  });

  it('skips a due ticket whose hash already expired', async () => {
    redis = new Redis(testEnv.REDIS_URL);
    const store = createRedisPushTicketStore(redis);
    const ticketId = `ticket-${randomUUID()}`;
    await redis.zadd('notify:push-tickets', Date.now() - 20 * 60 * 1000, ticketId);

    const due = await store.takeDue(15 * 60 * 1000);
    expect(due.find((entry) => entry.ticketId === ticketId)).toBeUndefined();
  });
});
