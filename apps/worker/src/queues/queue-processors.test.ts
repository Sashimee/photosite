import type { Job } from 'bullmq';
import type { Logger } from 'nestjs-pino';
import { describe, expect, it, vi } from 'vitest';
import { createValidatingProcessor } from './queue-processors.js';

function fakeJob<T>(data: T): Job<T> {
  return { id: 'job-1', data } as unknown as Job<T>;
}

function fakeLogger(): { logger: Logger; log: ReturnType<typeof vi.fn> } {
  const log = vi.fn();
  const logger = { log, warn: vi.fn(), error: vi.fn() } as unknown as Logger;
  return { logger, log };
}

describe('createValidatingProcessor', () => {
  it('resolves and logs receipt for a payload matching the queue schema', async () => {
    const { logger, log } = fakeLogger();
    const processor = createValidatingProcessor('file-scan', logger);

    await expect(
      processor(
        fakeJob({ uploadId: '3fa85f64-5717-4562-b3fc-2c963f66afa6' }),
        undefined,
        undefined as never,
      ),
    ).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({ queue: 'file-scan', jobId: 'job-1' }) as unknown,
      expect.any(String) as unknown,
    );
  });

  it('rejects a payload that fails the queue schema instead of completing silently', async () => {
    const { logger, log } = fakeLogger();
    const processor = createValidatingProcessor('image-process', logger);

    await expect(
      processor(fakeJob({ uploadId: 'not-a-uuid' }), undefined, undefined as never),
    ).rejects.toThrow();
    expect(log).not.toHaveBeenCalled();
  });

  it('rejects a payload missing required fields', async () => {
    const { logger } = fakeLogger();
    const processor = createValidatingProcessor('uploads-cleanup', logger);

    // A real BullMQ job's `.data` is untyped JSON pulled back out of Redis,
    // so nothing prevents a caller from enqueueing an object missing
    // `uploadId`; the cast simulates that at the type level.
    await expect(
      processor(fakeJob({} as { uploadId: string }), undefined, undefined as never),
    ).rejects.toThrow();
  });
});
