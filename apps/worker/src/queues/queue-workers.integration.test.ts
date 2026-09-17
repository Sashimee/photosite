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

const testEnv = requireIntegrationEnv(['REDIS_URL']);

describe('QueueWorkersService against a real Redis', () => {
  if (!testEnv) {
    it.skip('fails a malformed job with a logged reason (skipped: REDIS_URL is not set)', () =>
      undefined);
    return;
  }

  const fakeLogger = { log: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() };
  let moduleRef: TestingModule;
  let producerConnection: Redis;
  let queue: Queue;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(APP_CONFIG)
      .useValue({ ...TEST_ENV, REDIS_URL: testEnv.REDIS_URL, HEALTH_PORT: 4102 })
      .overrideProvider(Logger)
      .useValue(fakeLogger)
      .compile();
    await moduleRef.init();

    producerConnection = new Redis(testEnv.REDIS_URL, { maxRetriesPerRequest: null });
    queue = new Queue('file-scan', { connection: producerConnection });
  });

  afterAll(async () => {
    await queue.close();
    producerConnection.disconnect();
    await moduleRef.close();
  });

  it('marks a job with a payload that fails the shared schema as failed and logs the reason', async () => {
    const job = await queue.add('scan', { uploadId: 'not-a-uuid' });

    await vi.waitFor(
      async () => {
        expect(await job.getState()).toBe('failed');
      },
      { timeout: 5000, interval: 100 },
    );

    expect(fakeLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ queue: 'file-scan', jobId: job.id }) as unknown,
      'worker: job failed',
    );
  });

  it('completes a job with a payload that matches the shared schema', async () => {
    const job = await queue.add('scan', { uploadId: '3fa85f64-5717-4562-b3fc-2c963f66afa6' });

    await vi.waitFor(
      async () => {
        expect(await job.getState()).toBe('completed');
      },
      { timeout: 5000, interval: 100 },
    );

    expect(fakeLogger.log).toHaveBeenCalledWith(
      expect.objectContaining({ queue: 'file-scan', jobId: job.id }) as unknown,
      expect.any(String) as unknown,
    );
  });
});
