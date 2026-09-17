import { randomUUID } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createPrismaClient, type PrismaClient } from '@photoo/db';
import { Redis } from 'ioredis';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../../testing/create-test-app.js';
import { waitForLinkInEmail } from '../../testing/mailpit.js';
import { requireIntegrationEnv } from '../../testing/require-integration-env.js';
import { TEST_ENV } from '../../testing/test-env.js';

const testEnv = requireIntegrationEnv(['TEST_DATABASE_URL', 'REDIS_URL']);
const PASSWORD = `photoo-test-${randomUUID()}`;
const AUTH_FAKE_IP = '10.50.7.1';

function extractFragmentToken(link: string): string | null {
  const hashIndex = link.indexOf('#token=');
  if (hashIndex === -1) {
    return null;
  }
  return decodeURIComponent(link.slice(hashIndex + '#token='.length));
}

function uniqueEmail(label: string): string {
  return `notify-${label}-${randomUUID()}@photoo.test`;
}

interface NotificationBody {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  channels: string[];
  readAt: string | null;
  createdAt: string;
}

interface DeviceBody {
  id: string;
  platform: string;
  lastSeenAt: string;
}

interface PreferencesBody {
  preferences: { type: string; channel: string; enabled: boolean }[];
}

interface PaginatedBody<T> {
  items: T[];
  nextCursor: string | null;
}

describe('notifications integration', () => {
  if (!testEnv) {
    it.skip('skipped: TEST_DATABASE_URL or REDIS_URL is not set', () => undefined);
    return;
  }

  let app: NestFastifyApplication;
  let prisma: PrismaClient;
  let redis: Redis;
  const createdUserIds: string[] = [];

  function fastify() {
    return app.getHttpAdapter().getInstance();
  }

  async function signUpAndSignIn(): Promise<{ token: string; id: string }> {
    const email = uniqueEmail('user');
    const signUpResponse = await fastify().inject({
      method: 'POST',
      url: '/v1/auth/sign-up',
      remoteAddress: AUTH_FAKE_IP,
      payload: { email, password: PASSWORD, roles: ['client'], locale: 'en' },
    });
    const userId = signUpResponse.json<{ user: { id: string } }>().user.id;
    createdUserIds.push(userId);

    const link = await waitForLinkInEmail(email, /https?:\/\/\S*verify-email#token=\S+/);
    const token = extractFragmentToken(link);
    if (!token) {
      throw new Error(`no token found in verification link: ${link}`);
    }
    await fastify().inject({
      method: 'POST',
      url: '/v1/auth/verify-email',
      remoteAddress: AUTH_FAKE_IP,
      payload: { token },
    });

    const signInResponse = await fastify().inject({
      method: 'POST',
      url: '/v1/auth/sign-in',
      remoteAddress: AUTH_FAKE_IP,
      payload: { email, password: PASSWORD },
    });
    const body = signInResponse.json<{ user: { id: string }; session: { token: string } }>();
    return { token: body.session.token, id: body.user.id };
  }

  function authHeaders(token: string) {
    return { authorization: `Bearer ${token}` };
  }

  async function createNotification(userId: string, overrides: Record<string, unknown> = {}) {
    return prisma.notification.create({
      data: {
        userId,
        type: 'quote_received',
        payload: { quoteId: randomUUID() },
        channels: ['email', 'push', 'in_app'],
        ...overrides,
      },
    });
  }

  async function clearRateLimitKeys(): Promise<void> {
    const exact = createdUserIds.flatMap((id) => [
      `rate-limit:devices:register:account:${id}`,
      `lockout:devices:register:account:${id}`,
    ]);
    const patterns = [`rate-limit:auth:*:${AUTH_FAKE_IP}`, `lockout:auth:*:${AUTH_FAKE_IP}`];
    const globbed = (await Promise.all(patterns.map((pattern) => redis.keys(pattern)))).flat();
    const all = [...exact, ...globbed];
    if (all.length > 0) {
      await redis.del(...all);
    }
  }

  beforeAll(async () => {
    app = await createTestApp({
      ...TEST_ENV,
      DATABASE_URL: testEnv.TEST_DATABASE_URL,
      REDIS_URL: testEnv.REDIS_URL,
    });
    prisma = createPrismaClient(testEnv.TEST_DATABASE_URL);
    redis = new Redis(testEnv.REDIS_URL);
    await clearRateLimitKeys();
  });

  afterEach(async () => {
    await clearRateLimitKeys();
  });

  afterAll(async () => {
    if (createdUserIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    await prisma.$disconnect();
    redis.disconnect();
    await app.close();
  });

  describe('GET /v1/notifications', () => {
    it('requires a session', async () => {
      const response = await fastify().inject({ method: 'GET', url: '/v1/notifications' });
      expect(response.statusCode).toBe(401);
    });

    it('lists only the caller notifications, newest first', async () => {
      const user = await signUpAndSignIn();
      const other = await signUpAndSignIn();
      await createNotification(other.id);
      const first = await createNotification(user.id);
      const second = await createNotification(user.id);

      const response = await fastify().inject({
        method: 'GET',
        url: '/v1/notifications',
        headers: authHeaders(user.token),
      });
      expect(response.statusCode).toBe(200);
      const body = response.json<PaginatedBody<NotificationBody>>();
      const ids = body.items.map((item) => item.id);
      expect(ids).toEqual([second.id, first.id]);
    });

    it('filters to unread only when unread=true', async () => {
      const user = await signUpAndSignIn();
      const unread = await createNotification(user.id);
      await createNotification(user.id, { readAt: new Date() });

      const response = await fastify().inject({
        method: 'GET',
        url: '/v1/notifications?unread=true',
        headers: authHeaders(user.token),
      });
      const body = response.json<PaginatedBody<NotificationBody>>();
      expect(body.items.map((item) => item.id)).toEqual([unread.id]);
    });
  });

  describe('GET /v1/notifications/unread-count', () => {
    it('counts only the caller unread notifications', async () => {
      const user = await signUpAndSignIn();
      await createNotification(user.id);
      await createNotification(user.id);
      await createNotification(user.id, { readAt: new Date() });

      const response = await fastify().inject({
        method: 'GET',
        url: '/v1/notifications/unread-count',
        headers: authHeaders(user.token),
      });
      expect(response.json<{ count: number }>()).toEqual({ count: 2 });
    });
  });

  describe('POST /v1/notifications/:id/read', () => {
    it('marks the caller own notification as read', async () => {
      const user = await signUpAndSignIn();
      const notification = await createNotification(user.id);

      const response = await fastify().inject({
        method: 'POST',
        url: `/v1/notifications/${notification.id}/read`,
        headers: authHeaders(user.token),
      });
      expect(response.statusCode).toBe(200);
      expect(response.json<NotificationBody>().readAt).not.toBeNull();
    });

    it('returns 404 for another user notification', async () => {
      const owner = await signUpAndSignIn();
      const intruder = await signUpAndSignIn();
      const notification = await createNotification(owner.id);

      const response = await fastify().inject({
        method: 'POST',
        url: `/v1/notifications/${notification.id}/read`,
        headers: authHeaders(intruder.token),
      });
      expect(response.statusCode).toBe(404);
    });

    it('returns 404 for a notification that does not exist', async () => {
      const user = await signUpAndSignIn();
      const response = await fastify().inject({
        method: 'POST',
        url: `/v1/notifications/${randomUUID()}/read`,
        headers: authHeaders(user.token),
      });
      expect(response.statusCode).toBe(404);
    });
  });

  describe('POST /v1/notifications/read-all', () => {
    it('marks every unread caller notification as read and leaves others alone', async () => {
      const user = await signUpAndSignIn();
      const other = await signUpAndSignIn();
      await createNotification(user.id);
      await createNotification(user.id);
      const otherUnread = await createNotification(other.id);

      const response = await fastify().inject({
        method: 'POST',
        url: '/v1/notifications/read-all',
        headers: authHeaders(user.token),
      });
      expect(response.json<{ count: number }>()).toEqual({ count: 2 });

      const otherAfter = await prisma.notification.findUniqueOrThrow({
        where: { id: otherUnread.id },
      });
      expect(otherAfter.readAt).toBeNull();
    });
  });

  describe('notification preferences', () => {
    it('fills in defaults (every channel on) when nothing was ever saved', async () => {
      const user = await signUpAndSignIn();
      const response = await fastify().inject({
        method: 'GET',
        url: '/v1/me/notification-preferences',
        headers: authHeaders(user.token),
      });
      expect(response.statusCode).toBe(200);
      const body = response.json<PreferencesBody>();
      expect(body.preferences.every((entry) => entry.enabled)).toBe(true);
      expect(body.preferences.length).toBeGreaterThan(0);
    });

    it('suppresses a channel after a PUT, and keeps it suppressed on the next GET', async () => {
      const user = await signUpAndSignIn();
      const getResponse = await fastify().inject({
        method: 'GET',
        url: '/v1/me/notification-preferences',
        headers: authHeaders(user.token),
      });
      const current = getResponse.json<PreferencesBody>();
      const updated = current.preferences.map((entry) =>
        entry.type === 'quote_received' && entry.channel === 'email'
          ? { ...entry, enabled: false }
          : entry,
      );

      const putResponse = await fastify().inject({
        method: 'PUT',
        url: '/v1/me/notification-preferences',
        headers: authHeaders(user.token),
        payload: { preferences: updated },
      });
      expect(putResponse.statusCode).toBe(200);

      const afterGet = await fastify().inject({
        method: 'GET',
        url: '/v1/me/notification-preferences',
        headers: authHeaders(user.token),
      });
      const body = afterGet.json<PreferencesBody>();
      const entry = body.preferences.find(
        (candidate) => candidate.type === 'quote_received' && candidate.channel === 'email',
      );
      expect(entry?.enabled).toBe(false);
    });

    it('rejects disabling in_app with 400', async () => {
      const user = await signUpAndSignIn();
      const getResponse = await fastify().inject({
        method: 'GET',
        url: '/v1/me/notification-preferences',
        headers: authHeaders(user.token),
      });
      const current = getResponse.json<PreferencesBody>();
      const updated = current.preferences.map((entry) =>
        entry.channel === 'in_app' ? { ...entry, enabled: false } : entry,
      );

      const response = await fastify().inject({
        method: 'PUT',
        url: '/v1/me/notification-preferences',
        headers: authHeaders(user.token),
        payload: { preferences: updated },
      });
      expect(response.statusCode).toBe(400);
    });

    it('rejects an incomplete preference matrix with 400', async () => {
      const user = await signUpAndSignIn();
      const response = await fastify().inject({
        method: 'PUT',
        url: '/v1/me/notification-preferences',
        headers: authHeaders(user.token),
        payload: { preferences: [{ type: 'quote_received', channel: 'email', enabled: true }] },
      });
      expect(response.statusCode).toBe(400);
    });
  });

  describe('POST /v1/me/devices', () => {
    it('registers a device for the caller', async () => {
      const user = await signUpAndSignIn();
      const response = await fastify().inject({
        method: 'POST',
        url: '/v1/me/devices',
        headers: authHeaders(user.token),
        payload: { expoPushToken: `ExponentPushToken[${randomUUID()}]`, platform: 'ios' },
      });
      expect(response.statusCode).toBe(201);
      const body = response.json<DeviceBody>();
      expect(body.platform).toBe('ios');
    });

    it('rejects a malformed push token with 400', async () => {
      const user = await signUpAndSignIn();
      const response = await fastify().inject({
        method: 'POST',
        url: '/v1/me/devices',
        headers: authHeaders(user.token),
        payload: { expoPushToken: 'not-a-token', platform: 'ios' },
      });
      expect(response.statusCode).toBe(400);
    });

    it('reassigns a device already registered to another user', async () => {
      const first = await signUpAndSignIn();
      const second = await signUpAndSignIn();
      const token = `ExponentPushToken[${randomUUID()}]`;

      await fastify().inject({
        method: 'POST',
        url: '/v1/me/devices',
        headers: authHeaders(first.token),
        payload: { expoPushToken: token, platform: 'android' },
      });
      const reassign = await fastify().inject({
        method: 'POST',
        url: '/v1/me/devices',
        headers: authHeaders(second.token),
        payload: { expoPushToken: token, platform: 'android' },
      });
      expect(reassign.statusCode).toBe(201);

      const device = await prisma.device.findUniqueOrThrow({ where: { expoPushToken: token } });
      expect(device.userId).toBe(second.id);
    });

    it('rate limits device registration to 20 per hour', async () => {
      const user = await signUpAndSignIn();

      for (let i = 0; i < 20; i += 1) {
        const response = await fastify().inject({
          method: 'POST',
          url: '/v1/me/devices',
          headers: authHeaders(user.token),
          payload: { expoPushToken: `ExponentPushToken[${randomUUID()}]`, platform: 'ios' },
        });
        expect(response.statusCode).toBe(201);
      }

      const overflow = await fastify().inject({
        method: 'POST',
        url: '/v1/me/devices',
        headers: authHeaders(user.token),
        payload: { expoPushToken: `ExponentPushToken[${randomUUID()}]`, platform: 'ios' },
      });
      expect(overflow.statusCode).toBe(429);
    });
  });

  describe('DELETE /v1/me/devices/:id', () => {
    it('deletes the caller own device', async () => {
      const user = await signUpAndSignIn();
      const create = await fastify().inject({
        method: 'POST',
        url: '/v1/me/devices',
        headers: authHeaders(user.token),
        payload: { expoPushToken: `ExponentPushToken[${randomUUID()}]`, platform: 'web' },
      });
      const device = create.json<DeviceBody>();

      const response = await fastify().inject({
        method: 'DELETE',
        url: `/v1/me/devices/${device.id}`,
        headers: authHeaders(user.token),
      });
      expect(response.statusCode).toBe(204);

      const after = await prisma.device.findUnique({ where: { id: device.id } });
      expect(after).toBeNull();
    });

    it('returns 404 for another user device', async () => {
      const owner = await signUpAndSignIn();
      const intruder = await signUpAndSignIn();
      const create = await fastify().inject({
        method: 'POST',
        url: '/v1/me/devices',
        headers: authHeaders(owner.token),
        payload: { expoPushToken: `ExponentPushToken[${randomUUID()}]`, platform: 'web' },
      });
      const device = create.json<DeviceBody>();

      const response = await fastify().inject({
        method: 'DELETE',
        url: `/v1/me/devices/${device.id}`,
        headers: authHeaders(intruder.token),
      });
      expect(response.statusCode).toBe(404);
    });

    it('returns 404 for a device that does not exist', async () => {
      const user = await signUpAndSignIn();
      const response = await fastify().inject({
        method: 'DELETE',
        url: `/v1/me/devices/${randomUUID()}`,
        headers: authHeaders(user.token),
      });
      expect(response.statusCode).toBe(404);
    });
  });
});
