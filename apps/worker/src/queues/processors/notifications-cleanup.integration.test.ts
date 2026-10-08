import { randomUUID } from 'node:crypto';
import { createPrismaClient, type PrismaClient } from '@photoo/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { requireIntegrationEnv } from '../../testing/require-integration-env.js';
import { createNotificationsCleanupProcessor } from './notifications-cleanup.processor.js';

const testEnv = requireIntegrationEnv(['TEST_DATABASE_URL']);

function fakeLogger() {
  return { log: () => undefined, warn: () => undefined, error: () => undefined };
}

describe('createNotificationsCleanupProcessor against a real database', () => {
  if (!testEnv) {
    it.skip('skipped: TEST_DATABASE_URL is not set', () => undefined);
    return;
  }

  let prisma: PrismaClient;
  const runId = randomUUID().replaceAll('-', '').slice(0, 8);
  let userId: string;
  let oldDeviceId: string;
  let recentDeviceId: string;

  beforeAll(async () => {
    prisma = createPrismaClient(testEnv.TEST_DATABASE_URL);

    const user = await prisma.user.create({
      data: {
        email: `notifications-cleanup-${runId}@photoo.test`,
        emailVerifiedAt: new Date(),
        name: `Fx Notifications Cleanup ${runId}`,
        locale: 'en',
        countryCode: 'LU',
        roles: ['client'],
        status: 'active',
      },
    });
    userId = user.id;

    const dayMs = 24 * 60 * 60 * 1000;
    const oldDevice = await prisma.device.create({
      data: {
        userId,
        expoPushToken: `ExponentPushToken[old-${runId}]`,
        platform: 'ios',
        lastSeenAt: new Date(Date.now() - 400 * dayMs),
      },
    });
    oldDeviceId = oldDevice.id;
    const recentDevice = await prisma.device.create({
      data: {
        userId,
        expoPushToken: `ExponentPushToken[recent-${runId}]`,
        platform: 'android',
        lastSeenAt: new Date(Date.now() - 30 * dayMs),
      },
    });
    recentDeviceId = recentDevice.id;
  });

  afterAll(async () => {
    await prisma.device.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it('deletes the stale device, keeps the recent one and is a no-op on a second run', async () => {
    const processor = createNotificationsCleanupProcessor({
      prisma: { client: prisma },
      logger: fakeLogger() as never,
    });

    await processor(undefined as never);

    const afterFirstRun = await prisma.device.findMany({
      where: { userId },
      select: { id: true },
    });
    expect(afterFirstRun.map((device) => device.id)).toEqual([recentDeviceId]);
    expect(afterFirstRun.map((device) => device.id)).not.toContain(oldDeviceId);

    await processor(undefined as never);

    const afterSecondRun = await prisma.device.findMany({
      where: { userId },
      select: { id: true },
    });
    expect(afterSecondRun.map((device) => device.id)).toEqual([recentDeviceId]);
  });
});
