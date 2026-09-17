import type { Job } from 'bullmq';
import type { Logger } from 'nestjs-pino';
import { describe, expect, it, vi } from 'vitest';
import { createNotificationsCleanupProcessor } from './notifications-cleanup.processor.js';

function fakeLogger(): Logger {
  return { log: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger;
}

const FAKE_JOB = {} as Job;

describe('createNotificationsCleanupProcessor', () => {
  it('deletes notifications created more than 12 months ago', async () => {
    const deleteMany = vi.fn<
      (args: { where: { createdAt: { lt: Date } } }) => Promise<{ count: number }>
    >(() => Promise.resolve({ count: 3 }));

    await createNotificationsCleanupProcessor({
      prisma: { client: { notification: { deleteMany } } },
      logger: fakeLogger(),
    })(FAKE_JOB, undefined, undefined);

    expect(deleteMany).toHaveBeenCalledWith({
      where: { createdAt: { lt: expect.any(Date) as Date } },
    });
    const call = deleteMany.mock.calls[0]?.[0];
    if (!call) {
      throw new Error('deleteMany was not called');
    }
    const ageMs = Date.now() - call.where.createdAt.lt.getTime();
    expect(ageMs).toBeGreaterThan(364 * 24 * 60 * 60 * 1000);
    expect(ageMs).toBeLessThan(366 * 24 * 60 * 60 * 1000);
  });
});
