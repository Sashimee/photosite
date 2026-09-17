import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { Logger } from 'nestjs-pino';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../app.module.js';
import { APP_CONFIG } from '../config/env.js';
import { requireIntegrationEnv } from '../testing/require-integration-env.js';
import { TEST_ENV } from '../testing/test-env.js';

const testEnv = requireIntegrationEnv(['REDIS_URL', 'TEST_DATABASE_URL']);

// db 0 is shared with apps/api's integration suites, which enqueue real
// "file-scan" jobs there and run concurrently with this one; this real
// QueueWorkersService consumer would otherwise swallow those jobs.
const ISOLATED_REDIS_DB = '13';

function isolateRedisDb(url: string): string {
  const isolated = new URL(url);
  isolated.pathname = `/${ISOLATED_REDIS_DB}`;
  return isolated.toString();
}

describe('QueueWorkersService against a real Redis', () => {
  if (!testEnv) {
    it.skip('fails a malformed job with a logged reason (skipped: REDIS_URL or TEST_DATABASE_URL is not set)', () =>
      undefined);
    return;
  }

  const fakeLogger = { log: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() };
  let moduleRef: TestingModule;
  let producerConnection: Redis;
  let queue: Queue;

  beforeAll(async () => {
    const isolatedRedisUrl = isolateRedisDb(testEnv.REDIS_URL);
    moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(APP_CONFIG)
      .useValue({
        ...TEST_ENV,
        REDIS_URL: isolatedRedisUrl,
        DATABASE_URL: testEnv.TEST_DATABASE_URL,
        HEALTH_PORT: 4102,
      })
      .overrideProvider(Logger)
      .useValue(fakeLogger)
      .compile();
    await moduleRef.init();

    producerConnection = new Redis(isolatedRedisUrl, { maxRetriesPerRequest: null });
    queue = new Queue('file-scan', { connection: producerConnection });
  });

  afterAll(async () => {
    await queue.close();
    producerConnection.disconnect();
    await moduleRef.close();
  });

  it('marks a job with a payload that fails the shared schema as failed and logs the reason', async () => {
    const job = await queue.add('scan', { uploadId: 'not-a-uuid' });

    // The job's Redis state and the worker's local 'failed' event (which
    // drives fakeLogger.error) aren't written atomically, so job.getState()
    // can already read "failed" before the event fires; both must be polled
    // together, not asserted right after the state check alone resolves.
    await vi.waitFor(
      async () => {
        expect(await job.getState()).toBe('failed');
        expect(fakeLogger.error).toHaveBeenCalledWith(
          expect.objectContaining({ queue: 'file-scan', jobId: job.id }) as unknown,
          'worker: job failed',
        );
      },
      { timeout: 5000, interval: 100 },
    );
  });

  it('completes, rather than fails, a well-formed job for an upload row that no longer exists', async () => {
    const uploadId = '3fa85f64-5717-4562-b3fc-2c963f66afa6';
    const job = await queue.add('scan', { uploadId });

    await vi.waitFor(
      async () => {
        expect(await job.getState()).toBe('completed');
        expect(fakeLogger.warn).toHaveBeenCalledWith(
          expect.objectContaining({ uploadId }) as unknown,
          'file-scan: upload not found, skipping',
        );
      },
      { timeout: 5000, interval: 100 },
    );
  });
});
