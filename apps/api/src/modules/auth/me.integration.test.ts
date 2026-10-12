import { randomUUID } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createPrismaClient, type PrismaClient } from '@photoo/db';
import { Redis } from 'ioredis';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../../testing/create-test-app.js';
import { requireIntegrationEnv } from '../../testing/require-integration-env.js';
import { TEST_ENV } from '../../testing/test-env.js';

const testEnv = requireIntegrationEnv(['TEST_DATABASE_URL', 'REDIS_URL']);

const PASSWORD = `photoo-test-${randomUUID()}`;

describe('PATCH /v1/me/locale integration', () => {
  if (!testEnv) {
    it.skip('skipped: TEST_DATABASE_URL or REDIS_URL is not set', () => undefined);
    return;
  }

  let app: NestFastifyApplication;
  let prisma: PrismaClient;
  let redis: Redis;
  const createdEmails: string[] = [];

  async function clearRateLimitKeys(): Promise<void> {
    const keys = [
      ...(await redis.keys('rate-limit:auth:*')),
      ...(await redis.keys('lockout:auth:*')),
    ];
    if (keys.length > 0) {
      await redis.del(...keys);
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

  afterEach(clearRateLimitKeys);

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { in: createdEmails } } });
    await prisma.$disconnect();
    redis.disconnect();
    await app.close();
  });

  function fastify() {
    return app.getHttpAdapter().getInstance();
  }

  async function signedInUser(
    label: string,
  ): Promise<{ email: string; token: string; cookie: string }> {
    const email = `me-${label}-${randomUUID()}@photoo.test`;
    createdEmails.push(email);
    const signUp = await fastify().inject({
      method: 'POST',
      url: '/v1/auth/sign-up',
      payload: { email, password: PASSWORD, roles: ['client'], locale: 'en' },
    });
    expect(signUp.statusCode).toBe(201);
    await prisma.user.update({ where: { email }, data: { emailVerifiedAt: new Date() } });
    const signIn = await fastify().inject({
      method: 'POST',
      url: '/v1/auth/sign-in',
      payload: { email, password: PASSWORD },
    });
    expect(signIn.statusCode).toBe(200);
    const sessionCookie = signIn.cookies.find((candidate) => candidate.name === 'photoo_session');
    if (!sessionCookie) {
      throw new Error('expected a photoo_session cookie on sign-in');
    }
    return {
      email,
      token: signIn.json<{ session: { token: string } }>().session.token,
      cookie: `${sessionCookie.name}=${sessionCookie.value}`,
    };
  }

  function patchLocale(token: string | null, payload: unknown) {
    return fastify().inject({
      method: 'PATCH',
      url: '/v1/me/locale',
      headers: token ? { authorization: `Bearer ${token}` } : {},
      payload: payload as Record<string, unknown>,
    });
  }

  it('updates the caller locale, returns the user and leaves other users alone', async () => {
    const caller = await signedInUser('caller');
    const other = await signedInUser('other');

    const response = await patchLocale(caller.token, { locale: 'de' });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ user: { email: string; locale: string } }>();
    expect(body.user.email).toBe(caller.email);
    expect(body.user.locale).toBe('de');
    expect((await prisma.user.findUniqueOrThrow({ where: { email: caller.email } })).locale).toBe(
      'de',
    );
    expect((await prisma.user.findUniqueOrThrow({ where: { email: other.email } })).locale).toBe(
      'en',
    );

    const session = await fastify().inject({
      method: 'GET',
      url: '/v1/auth/session',
      headers: { authorization: `Bearer ${caller.token}` },
    });
    expect(session.json<{ user: { locale: string } }>().user.locale).toBe('de');
  });

  it('writes no audit log row', async () => {
    const caller = await signedInUser('audit');
    const user = await prisma.user.findUniqueOrThrow({ where: { email: caller.email } });
    const before = await prisma.auditLog.count({ where: { actorId: user.id } });

    await patchLocale(caller.token, { locale: 'fr' });

    expect(await prisma.auditLog.count({ where: { actorId: user.id } })).toBe(before);
  });

  it('rejects an unknown locale with 400 and keeps the stored one', async () => {
    const caller = await signedInUser('invalid');

    const response = await patchLocale(caller.token, { locale: 'xx' });

    expect(response.statusCode).toBe(400);
    expect((await prisma.user.findUniqueOrThrow({ where: { email: caller.email } })).locale).toBe(
      'en',
    );
  });

  it('rejects extra body fields with 400', async () => {
    const caller = await signedInUser('extra');

    const response = await patchLocale(caller.token, { locale: 'fr', roles: ['admin'] });

    expect(response.statusCode).toBe(400);
  });

  it('answers 401 without a session', async () => {
    const response = await patchLocale(null, { locale: 'fr' });

    expect(response.statusCode).toBe(401);
  });

  it('answers 401 with an invalid bearer token', async () => {
    const response = await patchLocale('not-a-session', { locale: 'fr' });

    expect(response.statusCode).toBe(401);
  });

  it('accepts a cookie session with a same-origin Origin header', async () => {
    const caller = await signedInUser('cookie');

    const response = await fastify().inject({
      method: 'PATCH',
      url: '/v1/me/locale',
      headers: { cookie: caller.cookie, origin: 'http://localhost:3000' },
      payload: { locale: 'pt' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<{ user: { locale: string } }>().user.locale).toBe('pt');
  });

  it('rejects a cookie session from a cross-site Origin with 403 and keeps the locale', async () => {
    const caller = await signedInUser('csrf');

    const response = await fastify().inject({
      method: 'PATCH',
      url: '/v1/me/locale',
      headers: { cookie: caller.cookie, origin: 'https://evil.example' },
      payload: { locale: 'es' },
    });

    expect(response.statusCode).toBe(403);
    expect((await prisma.user.findUniqueOrThrow({ where: { email: caller.email } })).locale).toBe(
      'en',
    );
  });
});
