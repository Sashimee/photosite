import type { Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import { describe, expect, it, vi } from 'vitest';
import { shutdownWorkers } from './graceful-shutdown.js';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function fakeWorker(closeDelayMs: number): { worker: Worker; closed: () => boolean } {
  let closed = false;
  const close = vi.fn(async () => {
    await delay(closeDelayMs);
    closed = true;
  });
  return { worker: { close } as unknown as Worker, closed: () => closed };
}

function fakeConnection(): { connection: Redis; disconnect: ReturnType<typeof vi.fn> } {
  const disconnect = vi.fn();
  return { connection: { disconnect } as unknown as Redis, disconnect };
}

describe('shutdownWorkers', () => {
  it('waits for an active job to finish before disconnecting', async () => {
    const { worker, closed } = fakeWorker(20);
    const { connection, disconnect } = fakeConnection();
    const logger = { warn: vi.fn() };

    await shutdownWorkers([worker], [connection], 1000, logger);

    expect(closed()).toBe(true);
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('disconnects and logs a warning once the timeout elapses without the job finishing', async () => {
    const { worker, closed } = fakeWorker(1000);
    const { connection, disconnect } = fakeConnection();
    const logger = { warn: vi.fn() };

    await shutdownWorkers([worker], [connection], 10, logger);

    expect(closed()).toBe(false);
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ timeoutMs: 10 }) as unknown,
      expect.any(String) as unknown,
    );
  });

  it('disconnects every connection even with no workers', async () => {
    const { connection, disconnect } = fakeConnection();
    const logger = { warn: vi.fn() };

    await shutdownWorkers([], [connection], 1000, logger);

    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});
