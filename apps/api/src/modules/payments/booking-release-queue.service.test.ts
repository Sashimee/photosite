import type { Logger } from 'nestjs-pino';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../config/env.js';
import type { BookingReleaseService } from './booking-release.service.js';

const upsertJobScheduler = vi.fn();
const workerOn = vi.fn();
let processor: ((job: { data: unknown }) => Promise<unknown>) | undefined;

vi.mock('bullmq', () => ({
  Queue: vi.fn().mockImplementation(function FakeQueue() {
    return { upsertJobScheduler, close: vi.fn() };
  }),
  Worker: vi.fn().mockImplementation(function FakeWorker(
    _name: string,
    fn: (job: { data: unknown }) => Promise<unknown>,
  ) {
    processor = fn;
    return { on: workerOn, close: vi.fn() };
  }),
}));

vi.mock('ioredis', () => ({
  Redis: vi.fn().mockImplementation(function FakeRedis() {
    return { disconnect: vi.fn() };
  }),
}));

import { Queue } from 'bullmq';
import { BookingReleaseQueueService } from './booking-release-queue.service.js';

function config(interval: number): Env {
  return {
    REDIS_URL: 'redis://localhost:6379',
    BOOKING_RELEASE_INTERVAL_MS: interval,
  } as unknown as Env;
}

const warn = vi.fn();
const logger = { log: vi.fn(), warn, error: vi.fn() } as unknown as Logger;

describe('BookingReleaseQueueService', () => {
  beforeEach(() => {
    vi.mocked(Queue).mockClear();
    upsertJobScheduler.mockReset();
    processor = undefined;
  });

  it('does not touch Redis when the interval is 0', async () => {
    const sweep = vi.fn();
    const service = new BookingReleaseQueueService(
      config(0),
      { sweep } as unknown as BookingReleaseService,
      logger,
    );

    await service.onApplicationBootstrap();

    expect(Queue).not.toHaveBeenCalled();
    expect(upsertJobScheduler).not.toHaveBeenCalled();
  });

  it('schedules one repeatable sweep whose processor runs the release sweep', async () => {
    const sweep = vi.fn(() =>
      Promise.resolve({ attempted: 0, released: 0, skipped: 0, failed: 0 }),
    );
    const service = new BookingReleaseQueueService(
      config(60_000),
      { sweep } as unknown as BookingReleaseService,
      logger,
    );

    await service.onApplicationBootstrap();

    expect(upsertJobScheduler).toHaveBeenCalledWith(
      'booking-release',
      { every: 60_000 },
      { name: 'sweep', data: {} },
    );
    await processor?.({ data: {} });
    expect(sweep).toHaveBeenCalledTimes(1);
    await expect(processor?.({ data: { bookingId: 'x' } })).rejects.toThrow();
  });

  it('keeps booting when the scheduler cannot be upserted', async () => {
    upsertJobScheduler.mockRejectedValueOnce(new Error('redis down'));
    const service = new BookingReleaseQueueService(
      config(60_000),
      { sweep: vi.fn() } as unknown as BookingReleaseService,
      logger,
    );

    await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });
});
