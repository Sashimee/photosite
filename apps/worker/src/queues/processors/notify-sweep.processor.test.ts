import type { Job } from 'bullmq';
import type { Logger } from 'nestjs-pino';
import { describe, expect, it, vi } from 'vitest';
import {
  createNotifySweepProcessor,
  type PendingNotificationRow,
} from './notify-sweep.processor.js';

function fakeLogger(): Logger {
  return { log: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger;
}

const FAKE_JOB = {} as Job;

describe('createNotifySweepProcessor', () => {
  it('re-enqueues a stale row that still wants a channel it has not sent on', async () => {
    const row: PendingNotificationRow = {
      id: 'notification-1',
      channels: ['email', 'push', 'in_app'],
      emailSentAt: null,
      pushSentAt: new Date(),
    };
    const findMany = vi.fn(() => Promise.resolve([row]));
    const add = vi.fn(() => Promise.resolve());

    await createNotifySweepProcessor({
      prisma: { client: { notification: { findMany } } },
      notifyQueue: { add },
      logger: fakeLogger(),
    })(FAKE_JOB, undefined, undefined);

    expect(add).toHaveBeenCalledWith(
      'notify',
      { notificationId: 'notification-1' },
      expect.objectContaining({ jobId: 'notification-1' }),
    );
  });

  it('does not re-enqueue a row whose wanted channels are all already sent', async () => {
    const row: PendingNotificationRow = {
      id: 'notification-1',
      channels: ['email'],
      emailSentAt: new Date(),
      pushSentAt: null,
    };
    const add = vi.fn(() => Promise.resolve());

    await createNotifySweepProcessor({
      prisma: { client: { notification: { findMany: () => Promise.resolve([row]) } } },
      notifyQueue: { add },
      logger: fakeLogger(),
    })(FAKE_JOB, undefined, undefined);

    expect(add).not.toHaveBeenCalled();
  });

  it('queries only rows older than the staleness threshold with a pending channel', async () => {
    const findMany = vi.fn(() => Promise.resolve([]));

    await createNotifySweepProcessor({
      prisma: { client: { notification: { findMany } } },
      notifyQueue: { add: vi.fn() },
      logger: fakeLogger(),
    })(FAKE_JOB, undefined, undefined);

    expect(findMany).toHaveBeenCalledWith({
      where: {
        createdAt: { lt: expect.any(Date) as Date },
        OR: [{ emailSentAt: null }, { pushSentAt: null }],
      },
    });
  });
});
