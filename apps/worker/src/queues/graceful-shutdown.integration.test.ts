import { randomUUID } from 'node:crypto';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { requireIntegrationEnv } from '../testing/require-integration-env.js';
import { shutdownWorkers } from './graceful-shutdown.js';

const testEnv = requireIntegrationEnv(['REDIS_URL']);
const JOB_DURATION_MS = 200;

describe('shutdownWorkers against a real BullMQ worker', () => {
  if (!testEnv) {
    it.skip('waits for an active job to finish before disconnecting (skipped: REDIS_URL is not set)', () =>
      undefined);
    return;
  }

  let worker: Worker | undefined;
  let workerConnection: Redis | undefined;
  let queue: Queue | undefined;
  let producerConnection: Redis | undefined;

  afterEach(async () => {
    await queue?.close();
    producerConnection?.disconnect();
    worker = undefined;
    workerConnection = undefined;
    queue = undefined;
    producerConnection = undefined;
  });

  it('waits for the active job to finish before the connections disconnect', async () => {
    const queueName = `graceful-shutdown-test-${randomUUID()}`;
    let jobFinished = false;

    workerConnection = new Redis(testEnv.REDIS_URL, { maxRetriesPerRequest: null });
    worker = new Worker(
      queueName,
      async () => {
        await new Promise((resolve) => setTimeout(resolve, JOB_DURATION_MS));
        jobFinished = true;
      },
      { connection: workerConnection },
    );

    const becameActive = new Promise<void>((resolve) => {
      worker?.once('active', () => {
        resolve();
      });
    });

    producerConnection = new Redis(testEnv.REDIS_URL, { maxRetriesPerRequest: null });
    queue = new Queue(queueName, { connection: producerConnection });
    await queue.add('slow', {});
    await becameActive;

    const startedAt = Date.now();
    await shutdownWorkers([worker], [workerConnection], 5000, { warn: vi.fn() });
    const elapsedMs = Date.now() - startedAt;

    expect(jobFinished).toBe(true);
    expect(elapsedMs).toBeGreaterThanOrEqual(JOB_DURATION_MS - 20);
  });
});
