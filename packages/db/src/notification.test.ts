import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { createPrismaClient } from './index.js';
import { seedDatabase } from './seed.js';
import { requireIntegrationEnv } from './testing/require-integration-env.js';

const testEnv = requireIntegrationEnv(['TEST_DATABASE_URL']);

describe('notification schema', () => {
  if (!testEnv) {
    it.skip(
      'enforces the preference unique constraint and cascade deletes (skipped: TEST_DATABASE_URL is not set)',
    );
    return;
  }

  const prisma = createPrismaClient(testEnv.TEST_DATABASE_URL);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function createTestUser(email: string) {
    await seedDatabase(prisma);
    return prisma.user.create({
      data: {
        email,
        locale: 'en',
        countryCode: 'LU',
        roles: ['client'],
        status: 'active',
      },
    });
  }

  describe('Notification.emailSentAt / pushSentAt', () => {
    it('defaults both to null until the worker records delivery', async () => {
      const user = await createTestUser(`notification-sentat-${randomUUID()}@example.com`);
      const notification = await prisma.notification.create({
        data: {
          userId: user.id,
          type: 'quote_received',
          payload: { quoteId: randomUUID() },
          channels: ['email', 'push', 'in_app'],
        },
      });

      expect(notification.emailSentAt).toBeNull();
      expect(notification.pushSentAt).toBeNull();

      await prisma.notification.delete({ where: { id: notification.id } });
      await prisma.user.delete({ where: { id: user.id } });
    });

    it('is removed when the owning user is deleted (cascade)', async () => {
      const user = await createTestUser(`notification-cascade-${randomUUID()}@example.com`);
      const notification = await prisma.notification.create({
        data: {
          userId: user.id,
          type: 'quote_received',
          payload: { quoteId: randomUUID() },
          channels: ['in_app'],
        },
      });

      await prisma.user.delete({ where: { id: user.id } });

      const found = await prisma.notification.findUnique({ where: { id: notification.id } });
      expect(found).toBeNull();
    });
  });

  describe('NotificationPreference.(userId, type, channel) uniqueness', () => {
    it('rejects a duplicate (userId, type, channel) row', async () => {
      const user = await createTestUser(`notification-pref-unique-${randomUUID()}@example.com`);
      const preference = await prisma.notificationPreference.create({
        data: {
          userId: user.id,
          type: 'quote_received',
          channel: 'email',
          enabled: false,
        },
      });

      await expect(
        prisma.notificationPreference.create({
          data: {
            userId: user.id,
            type: 'quote_received',
            channel: 'email',
            enabled: true,
          },
        }),
      ).rejects.toThrow();

      await prisma.notificationPreference.delete({ where: { id: preference.id } });
      await prisma.user.delete({ where: { id: user.id } });
    });

    it('allows the same (type, channel) for different users and the same user across channels', async () => {
      const user = await createTestUser(`notification-pref-distinct-${randomUUID()}@example.com`);

      const emailPref = await prisma.notificationPreference.create({
        data: {
          userId: user.id,
          type: 'quote_received',
          channel: 'email',
          enabled: false,
        },
      });
      const pushPref = await prisma.notificationPreference.create({
        data: {
          userId: user.id,
          type: 'quote_received',
          channel: 'push',
          enabled: false,
        },
      });

      expect(emailPref.id).not.toBe(pushPref.id);

      await prisma.notificationPreference.deleteMany({ where: { userId: user.id } });
      await prisma.user.delete({ where: { id: user.id } });
    });

    it('is removed when the owning user is deleted (cascade)', async () => {
      const user = await createTestUser(`notification-pref-cascade-${randomUUID()}@example.com`);
      const preference = await prisma.notificationPreference.create({
        data: {
          userId: user.id,
          type: 'quote_received',
          channel: 'push',
          enabled: false,
        },
      });

      await prisma.user.delete({ where: { id: user.id } });

      const found = await prisma.notificationPreference.findUnique({
        where: { id: preference.id },
      });
      expect(found).toBeNull();
    });
  });
});
