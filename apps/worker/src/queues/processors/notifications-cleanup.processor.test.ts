import type { Job } from 'bullmq';
import type { Logger } from 'nestjs-pino';
import { describe, expect, it, vi } from 'vitest';
import { createNotificationsCleanupProcessor } from './notifications-cleanup.processor.js';

const FAKE_JOB = {} as Job;
const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

type DeleteMany<K extends string> = (args: {
  where: Record<K, { lt: Date }>;
}) => Promise<{ count: number }>;

function setup(deviceCount = 0) {
  const notificationDeleteMany = vi.fn<DeleteMany<'createdAt'>>(() =>
    Promise.resolve({ count: 3 }),
  );
  const deviceDeleteMany = vi.fn<DeleteMany<'lastSeenAt'>>(() =>
    Promise.resolve({ count: deviceCount }),
  );
  const log = vi.fn();
  const logger = { log, warn: vi.fn(), error: vi.fn() } as unknown as Logger;
  const run = () =>
    createNotificationsCleanupProcessor({
      prisma: {
        client: {
          notification: { deleteMany: notificationDeleteMany },
          device: { deleteMany: deviceDeleteMany },
        },
      },
      logger,
    })(FAKE_JOB, undefined, undefined);
  return { run, notificationDeleteMany, deviceDeleteMany, log };
}

describe('createNotificationsCleanupProcessor', () => {
  it('deletes notifications created more than 12 months ago', async () => {
    const { run, notificationDeleteMany } = setup();

    await run();

    expect(notificationDeleteMany).toHaveBeenCalledWith({
      where: { createdAt: { lt: expect.any(Date) as Date } },
    });
    const call = notificationDeleteMany.mock.calls[0]?.[0];
    if (!call) {
      throw new Error('deleteMany was not called');
    }
    const ageMs = Date.now() - call.where.createdAt.lt.getTime();
    expect(ageMs).toBeGreaterThan(364 * 24 * 60 * 60 * 1000);
    expect(ageMs).toBeLessThan(366 * 24 * 60 * 60 * 1000);
  });

  it('deletes devices last seen more than 12 months ago', async () => {
    const { run, deviceDeleteMany } = setup(2);

    await run();

    expect(deviceDeleteMany).toHaveBeenCalledTimes(1);
    const call = deviceDeleteMany.mock.calls[0]?.[0];
    if (!call) {
      throw new Error('device deleteMany was not called');
    }
    const ageMs = Date.now() - call.where.lastSeenAt.lt.getTime();
    expect(ageMs).toBeGreaterThan(YEAR_MS - 24 * 60 * 60 * 1000);
    expect(ageMs).toBeLessThan(YEAR_MS + 24 * 60 * 60 * 1000);
  });

  it('logs the device count without tokens or ids', async () => {
    const { run, log } = setup(2);

    await run();

    expect(log).toHaveBeenCalledWith(
      { count: 2 },
      'notifications-cleanup: deleted stale push devices',
    );
  });
});
