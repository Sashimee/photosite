import type { Job } from 'bullmq';
import type { Logger } from 'nestjs-pino';
import { describe, expect, it, vi } from 'vitest';
import {
  createNotifySweepProcessor,
  type PendingNotificationWhere,
} from './notify-sweep.processor.js';

function fakeLogger(): Logger {
  return { log: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger;
}

const FAKE_JOB = {} as Job;

describe('createNotifySweepProcessor', () => {
  it('re-enqueues every row the SQL query returns, with a fresh sweep jobId', async () => {
    const findMany = vi.fn(() => Promise.resolve([{ id: 'notification-1' }]));
    const add = vi.fn<
      (name: string, data: unknown, opts: { jobId: string; attempts: number }) => Promise<void>
    >(() => Promise.resolve());

    await createNotifySweepProcessor({
      prisma: { client: { notification: { findMany } } },
      notifyQueue: { add },
      logger: fakeLogger(),
    })(FAKE_JOB, undefined, undefined);

    expect(add).toHaveBeenCalledTimes(1);
    const [name, data, opts] = add.mock.calls[0] ?? [];
    if (!opts) {
      throw new Error('add was not called');
    }
    expect(name).toBe('notify');
    expect(data).toEqual({ notificationId: 'notification-1' });
    expect(opts.jobId).toMatch(/^notification-1:sweep:\d+$/);
    expect(opts.jobId).not.toBe('notification-1');
    expect(opts.attempts).toBeGreaterThan(1);
  });

  it('filters for a stale window (5 minutes to 48 hours) and a channel still wanting a channel it has not sent, in SQL', async () => {
    const findMany = vi.fn<
      (args: { where: PendingNotificationWhere; take: number }) => Promise<{ id: string }[]>
    >(() => Promise.resolve([]));

    await createNotifySweepProcessor({
      prisma: { client: { notification: { findMany } } },
      notifyQueue: { add: vi.fn() },
      logger: fakeLogger(),
    })(FAKE_JOB, undefined, undefined);

    expect(findMany).toHaveBeenCalledWith({
      where: {
        createdAt: { lt: expect.any(Date) as Date, gt: expect.any(Date) as Date },
        OR: [
          { channels: { has: 'email' }, emailSentAt: null },
          { channels: { has: 'push' }, pushSentAt: null },
        ],
      },
      take: 200,
    });
    const call = findMany.mock.calls[0]?.[0];
    const range = (call?.where.createdAt.gt.getTime() ?? 0) - Date.now();
    expect(Math.abs(range + 48 * 60 * 60 * 1000)).toBeLessThan(1000);
  });

  it('does not re-enqueue a row with only a disabled/unsent channel it never wanted (an in_app-only row never matches the query)', async () => {
    const findMany = vi.fn(() => Promise.resolve([]));
    const add = vi.fn();

    await createNotifySweepProcessor({
      prisma: { client: { notification: { findMany } } },
      notifyQueue: { add },
      logger: fakeLogger(),
    })(FAKE_JOB, undefined, undefined);

    expect(add).not.toHaveBeenCalled();
  });

  it('re-enqueues a notification even though a previous notify job for it already failed', async () => {
    const findMany = vi.fn(() => Promise.resolve([{ id: 'notification-1' }]));
    const add = vi.fn().mockResolvedValueOnce(undefined);

    await createNotifySweepProcessor({
      prisma: { client: { notification: { findMany } } },
      notifyQueue: { add },
      logger: fakeLogger(),
    })(FAKE_JOB, undefined, undefined);

    expect(add).toHaveBeenCalledTimes(1);
  });

  it('logs and continues past a failure to re-enqueue one row', async () => {
    const findMany = vi.fn(() =>
      Promise.resolve([{ id: 'notification-1' }, { id: 'notification-2' }]),
    );
    const add = vi
      .fn()
      .mockRejectedValueOnce(new Error('redis down'))
      .mockResolvedValueOnce(undefined);
    const error = vi.fn();
    const logger = { log: vi.fn(), warn: vi.fn(), error } as unknown as Logger;

    await createNotifySweepProcessor({
      prisma: { client: { notification: { findMany } } },
      notifyQueue: { add },
      logger,
    })(FAKE_JOB, undefined, undefined);

    expect(add).toHaveBeenCalledTimes(2);
    expect(error).toHaveBeenCalledTimes(1);
  });
});
