import { randomUUID } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createPrismaClient, type PrismaClient } from '@photoo/db';
import type { AdminPermission } from '@photoo/shared';
import { Redis } from 'ioredis';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../../testing/create-test-app.js';
import { waitForLinkInEmail } from '../../testing/mailpit.js';
import { requireIntegrationEnv } from '../../testing/require-integration-env.js';
import { generateTotpCode } from '../../testing/totp.js';
import { TEST_ENV } from '../../testing/test-env.js';

const testEnv = requireIntegrationEnv(['TEST_DATABASE_URL', 'REDIS_URL']);
const PASSWORD = `photoo-test-${randomUUID()}`;
const FAKE_IP = '10.50.14.1';

interface EmailPreviewBody {
  subject: string;
  html: string;
  text: string;
}

describe('admin email templates integration', () => {
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

  function uniqueEmail(label: string): string {
    return `email-templates-${label}-${randomUUID()}@photoo.test`;
  }

  function extractFragmentToken(link: string): string | null {
    const hashIndex = link.indexOf('#token=');
    if (hashIndex === -1) {
      return null;
    }
    return decodeURIComponent(link.slice(hashIndex + '#token='.length));
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

  async function clearRateLimitKeys(): Promise<void> {
    const patterns = [`rate-limit:auth:*:${FAKE_IP}`, `lockout:auth:*:${FAKE_IP}`];
    const globbed = (await Promise.all(patterns.map((pattern) => redis.keys(pattern)))).flat();
    if (globbed.length > 0) {
      await redis.del(...globbed);
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

  describe('GET /v1/admin/email-templates', () => {
    it('returns 401 when unauthenticated', async () => {
      const response = await fastify().inject({
        method: 'GET',
        url: '/v1/admin/email-templates',
        headers: { origin: 'http://localhost:3000' },
      });
      expect(response.statusCode).toBe(401);
    });

    it('returns 403 for an admin without the superadmin permission', async () => {
      const admin = await makeAdmin('list-no-permission', ['support']);
      const response = await fastify().inject({
        method: 'GET',
        url: '/v1/admin/email-templates',
        headers: admin.headers,
      });
      expect(response.statusCode).toBe(403);
    });

    it('lists the previewable template names', async () => {
      const admin = await makeAdmin('list-ok', ['superadmin']);
      const response = await fastify().inject({
        method: 'GET',
        url: '/v1/admin/email-templates',
        headers: admin.headers,
      });
      expect(response.statusCode).toBe(200);
      const body = response.json<string[]>();
      expect(body).toContain('quote_received');
      expect(body.length).toBeGreaterThan(0);
    });
  });

  describe('GET /v1/admin/email-templates/:template/preview', () => {
    it('returns 403 for an admin without the superadmin permission', async () => {
      const admin = await makeAdmin('preview-no-permission', ['support']);
      const response = await fastify().inject({
        method: 'GET',
        url: '/v1/admin/email-templates/quote_received/preview?locale=en',
        headers: admin.headers,
      });
      expect(response.statusCode).toBe(403);
    });

    it('returns 400 for an unknown template', async () => {
      const admin = await makeAdmin('preview-unknown-template', ['superadmin']);
      const response = await fastify().inject({
        method: 'GET',
        url: '/v1/admin/email-templates/not_a_template/preview?locale=en',
        headers: admin.headers,
      });
      expect(response.statusCode).toBe(400);
    });

    it('returns 400 for an unsupported locale', async () => {
      const admin = await makeAdmin('preview-unsupported-locale', ['superadmin']);
      const response = await fastify().inject({
        method: 'GET',
        url: '/v1/admin/email-templates/quote_received/preview?locale=xx',
        headers: admin.headers,
      });
      expect(response.statusCode).toBe(400);
    });

    it('renders a notify template from fixed sample data', async () => {
      const admin = await makeAdmin('preview-notify-ok', ['superadmin']);
      const response = await fastify().inject({
        method: 'GET',
        url: '/v1/admin/email-templates/quote_received/preview?locale=en',
        headers: admin.headers,
      });
      expect(response.statusCode).toBe(200);
      const body = response.json<EmailPreviewBody>();
      expect(body.subject.length).toBeGreaterThan(0);
      expect(body.html).toContain('<');
      expect(body.text.length).toBeGreaterThan(0);
    });

    it('renders an auth template from fixed sample data', async () => {
      const admin = await makeAdmin('preview-auth-ok', ['superadmin']);
      const response = await fastify().inject({
        method: 'GET',
        url: '/v1/admin/email-templates/verify-email/preview?locale=en',
        headers: admin.headers,
      });
      expect(response.statusCode).toBe(200);
      const body = response.json<EmailPreviewBody>();
      expect(body.subject.length).toBeGreaterThan(0);
      expect(body.html).toContain('<');
      expect(body.text.length).toBeGreaterThan(0);
    });
  });
});
