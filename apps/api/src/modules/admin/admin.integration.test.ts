import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createPrismaClient, type PrismaClient } from '@photoo/db';
import { ADMIN_PERMISSIONS, type AdminPermission } from '@photoo/shared';
import { Redis } from 'ioredis';
import { io, type Socket as ClientSocket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../app.module.js';
import { TWO_FACTOR_VERIFICATION_WINDOW_MS } from '../../common/auth/require-admin.js';
import { configureApp } from '../../bootstrap/configure-app.js';
import { createFastifyAdapter } from '../../bootstrap/fastify-adapter.js';
import { APP_CONFIG, type Env } from '../../config/env.js';
import { waitForLinkInEmail } from '../../testing/mailpit.js';
import { requireIntegrationEnv } from '../../testing/require-integration-env.js';
import { generateTotpCode } from '../../testing/totp.js';
import { TEST_ENV } from '../../testing/test-env.js';
import { TestEmailWorkerModule } from '../../testing/test-email-worker.module.js';
import { RedisIoAdapter } from '../chat/socket-io-redis-adapter.js';
import { AdminAuditService } from './admin-audit.service.js';
import { AdminPermissionsService } from './admin-permissions.service.js';

const testEnv = requireIntegrationEnv(['TEST_DATABASE_URL', 'REDIS_URL']);
const PASSWORD = `photoo-test-${randomUUID()}`;
const FAKE_IP = '10.50.10.1';

function extractFragmentToken(link: string): string | null {
  const hashIndex = link.indexOf('#token=');
  if (hashIndex === -1) {
    return null;
  }
  return decodeURIComponent(link.slice(hashIndex + '#token='.length));
}

function uniqueEmail(label: string): string {
  return `admin-${label}-${randomUUID()}@photoo.test`;
}

interface UserBody {
  id: string;
  email: string;
  status: string;
  roles: string[];
  name: string | null;
  photographerProfile: { slug: string; isPublished: boolean } | null;
}

interface AdminMeBody {
  permissions: string[];
  twoFactorExpiresAt: string | null;
}

interface PageBody<T> {
  items: T[];
  nextCursor: string | null;
}

interface PlatformSettingsBody {
  feePercent: number;
  autoReleaseDays: number;
}

interface AuditLogEntryBody {
  id: string;
  actorId: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  before: unknown;
  after: unknown;
  occurredAt: string;
}

async function createAdminTestApp(
  env: Env,
): Promise<{ app: NestFastifyApplication; baseUrl: string }> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule, TestEmailWorkerModule] })
    .overrideProvider(APP_CONFIG)
    .useValue(env)
    .compile();

  const app = moduleRef.createNestApplication<NestFastifyApplication>(
    createFastifyAdapter(env.TRUSTED_PROXIES),
  );
  await configureApp(app, env);
  const redisIoAdapter = new RedisIoAdapter(app, env.REDIS_URL);
  redisIoAdapter.connectToRedis();
  app.useWebSocketAdapter(redisIoAdapter);
  await app.listen(0, '127.0.0.1');

  const address = app.getHttpServer().address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return { app, baseUrl: `http://127.0.0.1:${String(port)}` };
}

describe('admin integration', () => {
  if (!testEnv) {
    it.skip('skipped: TEST_DATABASE_URL or REDIS_URL is not set', () => undefined);
    return;
  }

  let app: NestFastifyApplication;
  let baseUrl: string;
  let prisma: PrismaClient;
  let redis: Redis;
  const createdUserIds: string[] = [];
  const createdProfileIds: string[] = [];
  const sockets: ClientSocket[] = [];

  function fastify() {
    return app.getHttpAdapter().getInstance();
  }

  function authHeaders(token: string) {
    return { authorization: `Bearer ${token}` };
  }

  async function clearRateLimitKeys(): Promise<void> {
    const patterns = [`rate-limit:auth:*:${FAKE_IP}`, `lockout:auth:*:${FAKE_IP}`];
    const adminKeys = createdUserIds.flatMap((id) => [
      `rate-limit:admin:mutation:admin:${id}`,
      `lockout:admin:mutation:admin:${id}`,
    ]);
    const globbed = (await Promise.all(patterns.map((pattern) => redis.keys(pattern)))).flat();
    const all = [...globbed, ...adminKeys];
    if (all.length > 0) {
      await redis.del(...all);
    }
  }

  async function signUpVerifyAndSignIn(
    roles: readonly string[],
    label: string,
  ): Promise<{ token: string; id: string; email: string }> {
    const email = uniqueEmail(label);
    const signUpResponse = await fastify().inject({
      method: 'POST',
      url: '/v1/auth/sign-up',
      remoteAddress: FAKE_IP,
      payload: { email, password: PASSWORD, roles, locale: 'en' },
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
      remoteAddress: FAKE_IP,
      payload: { token },
    });

    const signInResponse = await fastify().inject({
      method: 'POST',
      url: '/v1/auth/sign-in',
      remoteAddress: FAKE_IP,
      payload: { email, password: PASSWORD },
    });
    const body = signInResponse.json<{ user: { id: string }; session: { token: string } }>();
    return { token: body.session.token, id: body.user.id, email };
  }

  function sessionCookieHeader(response: {
    cookies: { name: string; value: string }[];
  }): string | undefined {
    const cookie = response.cookies.find((candidate) => candidate.name === 'photoo_session');
    return cookie ? `${cookie.name}=${cookie.value}` : undefined;
  }

  // Mirrors verification.integration.test.ts's makeAdmin: an admin session
  // uses a cookie, not a bearer token, because verifyTOTP only forwards its
  // rotated token via Set-Cookie.
  async function makeAdmin(
    label: string,
    permissions: readonly AdminPermission[] = [],
  ): Promise<{ headers: { cookie: string; origin: string }; id: string; email: string }> {
    const admin = await signUpVerifyAndSignIn(['client'], label);
    await prisma.user.update({ where: { id: admin.id }, data: { roles: ['admin'] } });
    for (const permission of permissions) {
      await prisma.adminPermissionGrant.upsert({
        where: { userId_permission: { userId: admin.id, permission } },
        create: { userId: admin.id, permission, grantedByAdminId: admin.id },
        update: {},
      });
    }

    const signInResponse = await fastify().inject({
      method: 'POST',
      url: '/v1/auth/sign-in',
      remoteAddress: FAKE_IP,
      payload: { email: admin.email, password: PASSWORD },
    });
    let cookie = sessionCookieHeader(signInResponse);
    if (!cookie) {
      throw new Error('expected a session cookie on sign-in');
    }

    const enrollResponse = await fastify().inject({
      method: 'POST',
      url: '/v1/auth/totp/enroll',
      headers: { cookie, origin: 'http://localhost:3000' },
      payload: { password: PASSWORD },
    });
    const { secret } = enrollResponse.json<{ secret: string }>();
    const verifyResponse = await fastify().inject({
      method: 'POST',
      url: '/v1/auth/totp/verify',
      headers: { cookie, origin: 'http://localhost:3000' },
      payload: { code: generateTotpCode(secret) },
    });
    cookie = sessionCookieHeader(verifyResponse) ?? cookie;

    return {
      headers: { cookie, origin: 'http://localhost:3000' },
      id: admin.id,
      email: admin.email,
    };
  }

  async function createTargetUser(label: string): Promise<{ id: string; email: string }> {
    const user = await signUpVerifyAndSignIn(['client'], label);
    return user;
  }

  async function createPhotographerProfile(token: string, suffix: string) {
    const response = await fastify().inject({
      method: 'POST',
      url: '/v1/me/photographer-profile',
      headers: authHeaders(token),
      payload: {
        displayName: `Fx Admin Photog ${suffix}`,
        categories: ['portrait'],
        languages: ['en'],
        location: { lat: 49.61, lng: 6.13 },
        city: `Fx Admin City ${suffix}`,
        countryCode: 'LU',
      },
    });
    const profile = response.json<{ id: string; slug: string }>();
    createdProfileIds.push(profile.id);
    return profile;
  }

  function connectSocket(token: string): Promise<ClientSocket> {
    const socket = io(baseUrl, {
      path: '/v1/socket.io',
      transports: ['polling'],
      forceNew: true,
      reconnection: false,
      auth: { token },
    });
    sockets.push(socket);
    return new Promise((resolve, reject) => {
      socket.once('connect', () => {
        resolve(socket);
      });
      socket.once('connect_error', (error: Error) => {
        reject(error);
      });
    });
  }

  async function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('waitFor: condition was never met');
  }

  async function fetchUsersPage(
    query: string,
    cursor: string | null,
    headers: Record<string, string | undefined>,
  ): Promise<PageBody<UserBody>> {
    const cursorParam = cursor ? `&cursor=${encodeURIComponent(cursor)}` : '';
    const response = await fastify().inject({
      method: 'GET',
      url: `/v1/admin/users?${query}&limit=1${cursorParam}`,
      headers,
    });
    return response.json<PageBody<UserBody>>();
  }

  async function fetchAuditLogPage(
    query: string,
    cursor: string | null,
    headers: Record<string, string | undefined>,
  ): Promise<PageBody<AuditLogEntryBody>> {
    const cursorParam = cursor ? `&cursor=${encodeURIComponent(cursor)}` : '';
    const response = await fastify().inject({
      method: 'GET',
      url: `/v1/admin/audit-log?${query}&limit=1${cursorParam}`,
      headers,
    });
    return response.json<PageBody<AuditLogEntryBody>>();
  }

  beforeAll(async () => {
    const created = await createAdminTestApp({
      ...TEST_ENV,
      DATABASE_URL: testEnv.TEST_DATABASE_URL,
      REDIS_URL: testEnv.REDIS_URL,
    });
    app = created.app;
    baseUrl = created.baseUrl;
    prisma = createPrismaClient(testEnv.TEST_DATABASE_URL);
    redis = new Redis(testEnv.REDIS_URL);
    await clearRateLimitKeys();
  });

  afterEach(async () => {
    await clearRateLimitKeys();
    for (const socket of sockets.splice(0)) {
      socket.close();
    }
  });

  afterAll(async () => {
    if (createdProfileIds.length > 0) {
      await prisma.photographerProfile.deleteMany({ where: { id: { in: createdProfileIds } } });
    }
    if (createdUserIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    await prisma.$disconnect();
    redis.disconnect();
    await app.close();
  });

  describe('GET /v1/admin/me', () => {
    it('returns 403 for a non-admin', async () => {
      const client = await signUpVerifyAndSignIn(['client'], 'me-non-admin');
      const response = await fastify().inject({
        method: 'GET',
        url: '/v1/admin/me',
        headers: authHeaders(client.token),
      });
      expect(response.statusCode).toBe(403);
    });

    it("returns exactly the caller's own grants, and nothing about another admin", async () => {
      const admin = await makeAdmin('me-own-grants', ['support', 'moderation']);
      const otherAdmin = await makeAdmin('me-other-grants', ['finance', 'superadmin']);

      const response = await fastify().inject({
        method: 'GET',
        url: '/v1/admin/me',
        headers: admin.headers,
      });
      expect(response.statusCode).toBe(200);
      const body = response.json<AdminMeBody>();
      expect(body.permissions.sort()).toEqual(['moderation', 'support']);
      expect(JSON.stringify(body)).not.toContain(otherAdmin.id);
      for (const permission of ['finance', 'superadmin']) {
        expect(body.permissions).not.toContain(permission);
      }
    });

    it('returns no permissions for an admin with none granted', async () => {
      const admin = await makeAdmin('me-no-grants', []);
      const response = await fastify().inject({
        method: 'GET',
        url: '/v1/admin/me',
        headers: admin.headers,
      });
      expect(response.statusCode).toBe(200);
      expect(response.json<AdminMeBody>().permissions).toEqual([]);
    });

    it('derives twoFactorExpiresAt from the admin two-factor verification window', async () => {
      const admin = await makeAdmin('me-2fa-expiry', ['support']);
      const before = Date.now();
      const response = await fastify().inject({
        method: 'GET',
        url: '/v1/admin/me',
        headers: admin.headers,
      });
      const after = Date.now();
      expect(response.statusCode).toBe(200);
      const { twoFactorExpiresAt } = response.json<AdminMeBody>();
      if (!twoFactorExpiresAt) throw new Error('expected a twoFactorExpiresAt value');
      const expiresAtMs = new Date(twoFactorExpiresAt).getTime();
      expect(expiresAtMs).toBeGreaterThanOrEqual(before + TWO_FACTOR_VERIFICATION_WINDOW_MS - 1000);
      expect(expiresAtMs).toBeLessThanOrEqual(after + TWO_FACTOR_VERIFICATION_WINDOW_MS + 1000);
    });
  });

  describe('GET /v1/admin/users', () => {
    it('returns 403 for a non-admin', async () => {
      const client = await signUpVerifyAndSignIn(['client'], 'search-non-admin');
      const response = await fastify().inject({
        method: 'GET',
        url: '/v1/admin/users',
        headers: authHeaders(client.token),
      });
      expect(response.statusCode).toBe(403);
    });

    it('returns 403 for an admin without the support permission', async () => {
      const admin = await makeAdmin('search-no-permission', ['moderation']);
      const response = await fastify().inject({
        method: 'GET',
        url: '/v1/admin/users',
        headers: admin.headers,
      });
      expect(response.statusCode).toBe(403);
      expect(response.json<{ code: string }>().code).toBe('FORBIDDEN');
    });

    it('matches an exact id, an exact email, or a displayName prefix, but never a substring of the email', async () => {
      const admin = await makeAdmin('search-support', ['support']);
      const target = await createTargetUser('search-target');
      const suffix = target.id.slice(0, 8);
      await prisma.user.update({
        where: { id: target.id },
        data: { name: `Zz Search Target ${suffix}` },
      });

      const byId = await fastify().inject({
        method: 'GET',
        url: `/v1/admin/users?q=${target.id}`,
        headers: admin.headers,
      });
      expect(byId.json<PageBody<UserBody>>().items.map((u) => u.id)).toContain(target.id);

      const byEmail = await fastify().inject({
        method: 'GET',
        url: `/v1/admin/users?q=${encodeURIComponent(target.email)}`,
        headers: admin.headers,
      });
      expect(byEmail.json<PageBody<UserBody>>().items.map((u) => u.id)).toContain(target.id);

      const byNamePrefix = await fastify().inject({
        method: 'GET',
        url: `/v1/admin/users?q=${encodeURIComponent(`Zz Search Target ${suffix}`)}`,
        headers: admin.headers,
      });
      const namePrefixItems = byNamePrefix.json<PageBody<UserBody>>().items;
      expect(namePrefixItems.map((u) => u.id)).toContain(target.id);
      expect(namePrefixItems.find((u) => u.id === target.id)?.name).toBe(
        `Zz Search Target ${suffix}`,
      );

      const localPart = target.email.split('@')[0] ?? '';
      const bySubstring = await fastify().inject({
        method: 'GET',
        url: `/v1/admin/users?q=${encodeURIComponent(localPart)}`,
        headers: admin.headers,
      });
      expect(bySubstring.json<PageBody<UserBody>>().items.map((u) => u.id)).not.toContain(
        target.id,
      );
    });

    it('filters by role and status', async () => {
      const admin = await makeAdmin('search-filters', ['support']);
      const suffix = randomUUID().slice(0, 8);
      const photographer = await signUpVerifyAndSignIn(['photographer'], 'search-filter-photog');
      await prisma.user.update({
        where: { id: photographer.id },
        data: { name: `Filter Target ${suffix}` },
      });

      const response = await fastify().inject({
        method: 'GET',
        url: `/v1/admin/users?q=${encodeURIComponent(`Filter Target ${suffix}`)}&role=photographer&status=active&limit=100`,
        headers: admin.headers,
      });
      expect(response.statusCode).toBe(200);
      const body = response.json<PageBody<UserBody>>();
      expect(body.items.map((u) => u.id)).toContain(photographer.id);
      expect(
        body.items.every((u) => u.roles.includes('photographer') && u.status === 'active'),
      ).toBe(true);
    });

    it('paginates with no gaps or repeats', async () => {
      const admin = await makeAdmin('search-pagination', ['support']);
      const suffix = randomUUID().slice(0, 8);
      const created: string[] = [];
      for (let i = 0; i < 3; i += 1) {
        const user = await createTargetUser(`page-${suffix}-${String(i)}`);
        await prisma.user.update({
          where: { id: user.id },
          data: { name: `Page Target ${suffix}` },
        });
        created.push(user.id);
      }

      const items: UserBody[] = [];
      let cursor: string | null = null;
      const query = `q=${encodeURIComponent(`Page Target ${suffix}`)}`;
      for (let page = 0; page < 20; page += 1) {
        const body = await fetchUsersPage(query, cursor, admin.headers);
        expect(body.items.length).toBeLessThanOrEqual(1);
        items.push(...body.items);
        cursor = body.nextCursor;
        if (!cursor) break;
      }
      const ids = items.map((u) => u.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(created.every((id) => ids.includes(id))).toBe(true);
    });
  });

  describe('GET /v1/admin/users/:id', () => {
    it('returns 404 for an unknown user', async () => {
      const admin = await makeAdmin('get-not-found', ['support']);
      const response = await fastify().inject({
        method: 'GET',
        url: `/v1/admin/users/${randomUUID()}`,
        headers: admin.headers,
      });
      expect(response.statusCode).toBe(404);
    });

    it('returns the user, including their name and no photographer profile', async () => {
      const admin = await makeAdmin('get-ok', ['support']);
      const target = await createTargetUser('get-target');
      const response = await fastify().inject({
        method: 'GET',
        url: `/v1/admin/users/${target.id}`,
        headers: admin.headers,
      });
      expect(response.statusCode).toBe(200);
      const body = response.json<UserBody>();
      expect(body.id).toBe(target.id);
      expect(body.name).toBe(target.email.split('@')[0]);
      expect(body.photographerProfile).toBeNull();
    });

    it("includes the photographer profile's slug and published state", async () => {
      const admin = await makeAdmin('get-with-profile', ['support']);
      const photographer = await signUpVerifyAndSignIn(['photographer'], 'get-with-profile-target');
      const profile = await createPhotographerProfile(photographer.token, 'get-with-profile');
      await prisma.photographerProfile.update({
        where: { id: profile.id },
        data: { isPublished: true },
      });

      const response = await fastify().inject({
        method: 'GET',
        url: `/v1/admin/users/${photographer.id}`,
        headers: admin.headers,
      });
      expect(response.statusCode).toBe(200);
      const body = response.json<UserBody>();
      expect(body.photographerProfile).toEqual({ slug: profile.slug, isPublished: true });
    });
  });

  describe('POST /v1/admin/users/:id/suspend', () => {
    it('returns 403 for an admin without the support permission', async () => {
      const admin = await makeAdmin('suspend-no-permission', ['superadmin']);
      const target = await createTargetUser('suspend-no-perm-target');
      const response = await fastify().inject({
        method: 'POST',
        url: `/v1/admin/users/${target.id}/suspend`,
        headers: admin.headers,
        payload: { reason: 'Fraudulent listings' },
      });
      expect(response.statusCode).toBe(403);
    });

    it('returns 404 for an unknown user', async () => {
      const admin = await makeAdmin('suspend-not-found', ['support']);
      const response = await fastify().inject({
        method: 'POST',
        url: `/v1/admin/users/${randomUUID()}/suspend`,
        headers: admin.headers,
        payload: { reason: 'Fraudulent listings' },
      });
      expect(response.statusCode).toBe(404);
    });

    it('suspends the user, revokes sessions, disconnects sockets, and writes a redacted audit row', async () => {
      const admin = await makeAdmin('suspend-ok', ['support']);
      const target = await signUpVerifyAndSignIn(['client'], 'suspend-target');
      const socket = await connectSocket(target.token);
      expect(socket.connected).toBe(true);

      const sessionsBefore = await prisma.session.findMany({ where: { userId: target.id } });
      expect(sessionsBefore.length).toBeGreaterThan(0);

      const response = await fastify().inject({
        method: 'POST',
        url: `/v1/admin/users/${target.id}/suspend`,
        headers: admin.headers,
        remoteAddress: FAKE_IP,
        payload: { reason: 'Fraudulent listings' },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json<UserBody>().status).toBe('suspended');

      const sessionsAfter = await prisma.session.findMany({ where: { userId: target.id } });
      expect(sessionsAfter).toHaveLength(0);

      await waitFor(() => socket.disconnected);

      const auditRow = await prisma.auditLog.findFirst({
        where: { action: 'user.suspended', targetId: target.id },
        orderBy: { occurredAt: 'desc' },
      });
      expect(auditRow).not.toBeNull();
      expect(auditRow?.actorType).toBe('admin');
      expect(auditRow?.actorId).toBe(admin.id);
      expect(auditRow?.ip).toBe(FAKE_IP);
      expect(auditRow?.before).toEqual({ status: 'active' });
      expect(auditRow?.after).toEqual({ status: 'suspended', reason: 'Fraudulent listings' });
      expect(JSON.stringify(auditRow?.after)).not.toContain(target.email);

      const second = await fastify().inject({
        method: 'POST',
        url: `/v1/admin/users/${target.id}/suspend`,
        headers: admin.headers,
        payload: { reason: 'Again' },
      });
      expect(second.statusCode).toBe(409);
    });
  });

  describe('POST /v1/admin/users/:id/reactivate', () => {
    it('returns 409 for a user who is not suspended', async () => {
      const admin = await makeAdmin('reactivate-not-suspended', ['support']);
      const target = await createTargetUser('reactivate-not-suspended-target');
      const response = await fastify().inject({
        method: 'POST',
        url: `/v1/admin/users/${target.id}/reactivate`,
        headers: admin.headers,
      });
      expect(response.statusCode).toBe(409);
    });

    it('restores status only, never sessions', async () => {
      const admin = await makeAdmin('reactivate-ok', ['support']);
      const target = await signUpVerifyAndSignIn(['client'], 'reactivate-target');

      await fastify().inject({
        method: 'POST',
        url: `/v1/admin/users/${target.id}/suspend`,
        headers: admin.headers,
        payload: { reason: 'Investigation' },
      });

      const response = await fastify().inject({
        method: 'POST',
        url: `/v1/admin/users/${target.id}/reactivate`,
        headers: admin.headers,
      });
      expect(response.statusCode).toBe(200);
      expect(response.json<UserBody>().status).toBe('active');

      const sessions = await prisma.session.findMany({ where: { userId: target.id } });
      expect(sessions).toHaveLength(0);

      const auditRow = await prisma.auditLog.findFirst({
        where: { action: 'user.reactivated', targetId: target.id },
      });
      expect(auditRow).not.toBeNull();

      const signInAfter = await fastify().inject({
        method: 'POST',
        url: '/v1/auth/sign-in',
        remoteAddress: FAKE_IP,
        payload: { email: target.email, password: PASSWORD },
      });
      expect(signInAfter.statusCode).toBe(200);
    });
  });

  describe('PUT /v1/admin/users/:id/roles', () => {
    it('returns 403 for an admin without the superadmin permission', async () => {
      const admin = await makeAdmin('roles-no-permission', ['support']);
      const target = await createTargetUser('roles-no-perm-target');
      const response = await fastify().inject({
        method: 'PUT',
        url: `/v1/admin/users/${target.id}/roles`,
        headers: admin.headers,
        payload: { roles: ['client', 'photographer'] },
      });
      expect(response.statusCode).toBe(403);
    });

    it('returns 404 for an unknown user', async () => {
      const admin = await makeAdmin('roles-not-found', ['superadmin']);
      const response = await fastify().inject({
        method: 'PUT',
        url: `/v1/admin/users/${randomUUID()}/roles`,
        headers: admin.headers,
        payload: { roles: ['client'] },
      });
      expect(response.statusCode).toBe(404);
    });

    it('replaces the role set and writes an audit row', async () => {
      const admin = await makeAdmin('roles-ok', ['superadmin']);
      const target = await createTargetUser('roles-ok-target');

      const response = await fastify().inject({
        method: 'PUT',
        url: `/v1/admin/users/${target.id}/roles`,
        headers: admin.headers,
        remoteAddress: FAKE_IP,
        payload: { roles: ['client', 'photographer'] },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json<UserBody>().roles.sort()).toEqual(['client', 'photographer']);

      const auditRow = await prisma.auditLog.findFirst({
        where: { action: 'user.roles_set', targetId: target.id },
      });
      expect(auditRow?.before).toEqual({ roles: ['client'] });
      expect(auditRow?.after).toEqual({ roles: ['client', 'photographer'] });
    });

    it('unpublishes a published profile in the same transaction when photographer is removed', async () => {
      const admin = await makeAdmin('roles-unpublish', ['superadmin']);
      const photographer = await signUpVerifyAndSignIn(['photographer'], 'roles-unpublish-target');
      const profile = await createPhotographerProfile(photographer.token, 'roles-unpublish');
      await prisma.photographerProfile.update({
        where: { id: profile.id },
        data: {
          verificationStatus: 'verified',
          stripePayoutsEnabled: true,
          stripeAccountId: `acct_${profile.id}`,
          stripeOnboardingComplete: true,
          isPublished: true,
        },
      });

      const response = await fastify().inject({
        method: 'PUT',
        url: `/v1/admin/users/${photographer.id}/roles`,
        headers: admin.headers,
        payload: { roles: ['client'] },
      });
      expect(response.statusCode).toBe(200);

      const updatedProfile = await prisma.photographerProfile.findUniqueOrThrow({
        where: { id: profile.id },
      });
      expect(updatedProfile.isPublished).toBe(false);
    });
  });

  describe('GET and PATCH /v1/admin/settings', () => {
    it('returns 403 for an admin without the superadmin permission', async () => {
      const admin = await makeAdmin('settings-no-permission', ['support']);
      const response = await fastify().inject({
        method: 'GET',
        url: '/v1/admin/settings',
        headers: admin.headers,
      });
      expect(response.statusCode).toBe(403);
    });

    it('returns the current settings', async () => {
      const admin = await makeAdmin('settings-get', ['superadmin']);
      const response = await fastify().inject({
        method: 'GET',
        url: '/v1/admin/settings',
        headers: admin.headers,
      });
      expect(response.statusCode).toBe(200);
      const body = response.json<PlatformSettingsBody>();
      expect(typeof body.feePercent).toBe('number');
      expect(typeof body.autoReleaseDays).toBe('number');
    });

    it('rejects an unknown key', async () => {
      const admin = await makeAdmin('settings-unknown-key', ['superadmin']);
      const response = await fastify().inject({
        method: 'PATCH',
        url: '/v1/admin/settings',
        headers: admin.headers,
        payload: { feePercent: 6, notAThing: true },
      });
      expect(response.statusCode).toBe(400);
    });

    it('updates a setting and records the old and new value', async () => {
      const admin = await makeAdmin('settings-patch', ['superadmin']);
      const before = await fastify().inject({
        method: 'GET',
        url: '/v1/admin/settings',
        headers: admin.headers,
      });
      const beforeBody = before.json<PlatformSettingsBody>();
      const nextFeePercent = beforeBody.feePercent === 8 ? 9 : 8;

      const response = await fastify().inject({
        method: 'PATCH',
        url: '/v1/admin/settings',
        headers: admin.headers,
        remoteAddress: FAKE_IP,
        payload: { feePercent: nextFeePercent },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json<PlatformSettingsBody>().feePercent).toBe(nextFeePercent);
      expect(response.json<PlatformSettingsBody>().autoReleaseDays).toBe(
        beforeBody.autoReleaseDays,
      );

      const auditRow = await prisma.auditLog.findFirst({
        where: { action: 'platform_settings.updated' },
        orderBy: { occurredAt: 'desc' },
      });
      expect(auditRow).not.toBeNull();
      expect((auditRow?.before as unknown as PlatformSettingsBody).feePercent).toBe(
        beforeBody.feePercent,
      );
      expect((auditRow?.after as unknown as PlatformSettingsBody).feePercent).toBe(nextFeePercent);

      await prisma.platformSetting.update({
        where: { key: 'feePercent' },
        data: { value: beforeBody.feePercent },
      });
    });
  });

  describe('GET /v1/admin/audit-log', () => {
    it('returns 403 for an admin without the superadmin permission', async () => {
      const admin = await makeAdmin('audit-log-no-permission', ['support']);
      const response = await fastify().inject({
        method: 'GET',
        url: '/v1/admin/audit-log',
        headers: admin.headers,
      });
      expect(response.statusCode).toBe(403);
    });

    it('filters by actor, target and a date range, and paginates with no gaps or repeats', async () => {
      const admin = await makeAdmin('audit-log-query', ['support', 'superadmin']);
      const target = await createTargetUser('audit-log-target');

      for (let i = 0; i < 3; i += 1) {
        await fastify().inject({
          method: 'POST',
          url: `/v1/admin/users/${target.id}/suspend`,
          headers: admin.headers,
          payload: { reason: `pagination-${String(i)}` },
        });
        await fastify().inject({
          method: 'POST',
          url: `/v1/admin/users/${target.id}/reactivate`,
          headers: admin.headers,
        });
      }

      const items: AuditLogEntryBody[] = [];
      let cursor: string | null = null;
      const query = `actorId=${admin.id}&targetId=${target.id}`;
      for (let page = 0; page < 40; page += 1) {
        const body = await fetchAuditLogPage(query, cursor, admin.headers);
        expect(body.items.length).toBeLessThanOrEqual(1);
        items.push(...body.items);
        cursor = body.nextCursor;
        if (!cursor) break;
      }

      expect(items.length).toBe(6);
      const ids = items.map((entry) => entry.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(items.every((entry) => entry.targetId === target.id)).toBe(true);
      expect(items.every((entry) => entry.actorId === admin.id)).toBe(true);

      const from = new Date(Date.now() + 60_000).toISOString();
      const futureOnly = await fastify().inject({
        method: 'GET',
        url: `/v1/admin/audit-log?actorId=${admin.id}&targetId=${target.id}&from=${from}`,
        headers: admin.headers,
      });
      expect(futureOnly.json<PageBody<AuditLogEntryBody>>().items).toHaveLength(0);
    });
  });

  describe('permission matrix', () => {
    const cases: { method: 'GET' | 'PATCH'; url: () => string; permission: AdminPermission }[] = [
      { method: 'GET', url: () => '/v1/admin/users', permission: 'support' },
      { method: 'GET', url: () => '/v1/admin/settings', permission: 'superadmin' },
      { method: 'GET', url: () => '/v1/admin/audit-log', permission: 'superadmin' },
    ];

    for (const testCase of cases) {
      it(`${testCase.method} ${testCase.url()} only allows the '${testCase.permission}' permission`, async () => {
        for (const permission of ADMIN_PERMISSIONS) {
          await clearRateLimitKeys();
          const admin = await makeAdmin(
            `matrix-${testCase.permission}-${permission}-${randomUUID().slice(0, 6)}`,
            [permission],
          );
          const response = await fastify().inject({
            method: testCase.method,
            url: testCase.url(),
            headers: admin.headers,
          });
          if (permission === testCase.permission) {
            expect(response.statusCode).not.toBe(403);
          } else {
            expect(response.statusCode).toBe(403);
          }
        }
      });
    }
  });

  describe('AdminPermissionsService', () => {
    it('refuses a self-grant', async () => {
      const superadmin = await makeAdmin('permissions-self-grant', ['superadmin']);
      const service = app.get(AdminPermissionsService);

      await expect(
        prisma.$transaction((tx) =>
          service.grant(tx, superadmin.id, superadmin.id, 'support', null),
        ),
      ).rejects.toThrow();
    });

    it('refuses a grant from a non-superadmin', async () => {
      const nonSuperadmin = await makeAdmin('permissions-non-superadmin', ['support']);
      const target = await createTargetUser('permissions-non-superadmin-target');
      const service = app.get(AdminPermissionsService);

      await expect(
        prisma.$transaction((tx) =>
          service.grant(tx, nonSuperadmin.id, target.id, 'moderation', null),
        ),
      ).rejects.toThrow();

      const grant = await prisma.adminPermissionGrant.findUnique({
        where: { userId_permission: { userId: target.id, permission: 'moderation' } },
      });
      expect(grant).toBeNull();
    });

    it('grants and revokes, writing an audit row for each', async () => {
      const superadmin = await makeAdmin('permissions-grant-ok', ['superadmin']);
      const target = await createTargetUser('permissions-grant-ok-target');
      const service = app.get(AdminPermissionsService);

      await prisma.$transaction((tx) =>
        service.grant(tx, superadmin.id, target.id, 'moderation', null),
      );
      const granted = await prisma.adminPermissionGrant.findUnique({
        where: { userId_permission: { userId: target.id, permission: 'moderation' } },
      });
      expect(granted).not.toBeNull();
      const grantAudit = await prisma.auditLog.findFirst({
        where: { action: 'admin_permission.granted', targetId: target.id },
      });
      expect(grantAudit).not.toBeNull();

      await prisma.$transaction((tx) =>
        service.revoke(tx, superadmin.id, target.id, 'moderation', null),
      );
      const revoked = await prisma.adminPermissionGrant.findUnique({
        where: { userId_permission: { userId: target.id, permission: 'moderation' } },
      });
      expect(revoked).toBeNull();
      const revokeAudit = await prisma.auditLog.findFirst({
        where: { action: 'admin_permission.revoked', targetId: target.id },
      });
      expect(revokeAudit).not.toBeNull();
    });
  });

  describe('AdminAuditService', () => {
    it('never persists a row when its transaction rolls back, and always does when it commits', async () => {
      const admin = await makeAdmin('audit-service-tx', []);
      const auditService = app.get(AdminAuditService);
      const rollbackAction = `test.rollback.${randomUUID()}`;
      const commitAction = `test.commit.${randomUUID()}`;

      await expect(
        prisma.$transaction(async (tx) => {
          await auditService.record(tx, {
            actorId: admin.id,
            action: rollbackAction,
            targetType: 'User',
            targetId: admin.id,
          });
          throw new Error('force rollback');
        }),
      ).rejects.toThrow('force rollback');
      const rolledBack = await prisma.auditLog.findFirst({ where: { action: rollbackAction } });
      expect(rolledBack).toBeNull();

      await prisma.$transaction(async (tx) => {
        await auditService.record(tx, {
          actorId: admin.id,
          action: commitAction,
          targetType: 'User',
          targetId: admin.id,
        });
      });
      const committed = await prisma.auditLog.findFirst({ where: { action: commitAction } });
      expect(committed).not.toBeNull();
      expect(committed?.actorType).toBe('admin');
    });
  });
});
