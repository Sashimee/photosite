import { randomUUID } from 'node:crypto';
import { EMAIL_QUEUE_NAME } from '@photoo/shared';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { afterEach, describe, expect, it } from 'vitest';
import { requireIntegrationEnv } from '../testing/require-integration-env.js';

const testEnv = requireIntegrationEnv(['REDIS_URL']);

// BullMQ 6 rejects a custom jobId containing ':' (it collides with its own
// internal key delimiter), which a fake in-memory queue in the unit tests
// doesn't catch. This exercises the real jobId format the processor uses
// (`${type}-${dataRequestId}`) against a real Queue/Redis to prove it's
// accepted, and that a retried job dedups on the same id.
describe('gdpr-export email jobId against a real Redis', () => {
  if (!testEnv) {
    it.skip('accepts the colon-free jobId and dedups on retry (skipped: REDIS_URL is not set)', () =>
      undefined);
    return;
  }

  let connection: Redis | undefined;
  let queue: Queue | undefined;

  afterEach(async () => {
    await queue?.close();
    connection?.disconnect();
    connection = undefined;
    queue = undefined;
  });

  it('accepts the colon-free jobId and dedups a second add with the same id', async () => {
    connection = new Redis(testEnv.REDIS_URL, { maxRetriesPerRequest: null });
    queue = new Queue(EMAIL_QUEUE_NAME, { connection });

    const dataRequestId = randomUUID();
    const jobId = `data-export-ready-${dataRequestId}`;
    const payload = {
      type: 'data-export-ready' as const,
      to: 'user@example.test',
      url: 'https://example.test/account',
      expiresAt: new Date().toISOString(),
    };

    const first = await queue.add(payload.type, payload, { jobId });
    expect(first.id).toBe(jobId);

    const second = await queue.add(payload.type, payload, { jobId });
    expect(second.id).toBe(jobId);

    const counts = await queue.getJobCounts('waiting', 'delayed');
    const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
    expect(total).toBe(1);
  });
});
