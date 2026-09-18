import { randomUUID } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createPrismaClient, Prisma, type PrismaClient } from '@photoo/db';
import { CONSENT_PURPOSES } from '@photoo/shared';
import { Redis } from 'ioredis';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../../testing/create-test-app.js';
import { waitForLinkInEmail } from '../../testing/mailpit.js';
import { requireIntegrationEnv } from '../../testing/require-integration-env.js';
import { TEST_ENV } from '../../testing/test-env.js';

const testEnv = requireIntegrationEnv(['TEST_DATABASE_URL', 'REDIS_URL']);
const PASSWORD = `photoo-test-${randomUUID()}`;
// Distinct per-file IP (issue #97): shared Redis and DB with other
// integration suites running in parallel.
const FAKE_IP = '10.50.13.1';

function extractFragmentToken(link: string): string | null {
  const hashIndex = link.indexOf('#token=');
  if (hashIndex === -1) {
    return null;
  }
  return decodeURIComponent(link.slice(hashIndex + '#token='.length));
}

function uniqueEmail(label: string): string {
  return `consents-${label}-${randomUUID()}@photoo.test`;
}

interface ConsentStateEntry {
  purpose: string;
  granted: boolean;
  policyVersion: string | null;
  recordedAt: string | null;
}

interface ConsentsBody {
  consents: ConsentStateEntry[];
}

interface ConsentRecordBody {
  id: string;
  purpose: string;
  granted: boolean;
  policyVersion: string;
  recordedAt: string;
}

describe('consents integration', () => {
  if (!testEnv) {
    it.skip('skipped: TEST_DATABASE_URL or REDIS_URL is not set', () => undefined);
    return;
  }

  let app: NestFastifyApplication;
  let prisma: PrismaClient;
  let redis: Redis;
  const createdUserIds: string[] = [];
  const createdAnonymousIds: string[] = [];

  function fastify() {
    return app.getHttpAdapter().getInstance();
  }

  function authHeaders(token: string) {
    return { authorization: `Bearer ${token}` };
  }

  async function signUpVerifyAndSignIn(
    label: string,
    anonymousId?: string,
  ): Promise<{ token: string; id: string; email: string }> {
    const email = uniqueEmail(label);
    const signUpResponse = await fastify().inject({
      method: 'POST',
      url: '/v1/auth/sign-up',
      remoteAddress: FAKE_IP,
      payload: {
        email,
        password: PASSWORD,
        roles: ['client'],
        locale: 'en',
        ...(anonymousId ? { anonymousId } : {}),
      },
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

  function newAnonymousId(): string {
    const id = `anon-${randomUUID()}`;
    createdAnonymousIds.push(id);
    return id;
  }

  async function clearRateLimitKeys(): Promise<void> {
    const patterns = [
      `rate-limit:auth:*:${FAKE_IP}`,
      `lockout:auth:*:${FAKE_IP}`,
      `rate-limit:consents:create:ip:${FAKE_IP}`,
      `lockout:consents:create:ip:${FAKE_IP}`,
    ];
    const accountKeys = createdUserIds.flatMap((id) => [
      `rate-limit:consents:create:account:${id}`,
      `lockout:consents:create:account:${id}`,
    ]);
    const globbed = (await Promise.all(patterns.map((pattern) => redis.keys(pattern)))).flat();
    const all = [...globbed, ...accountKeys];
    if (all.length > 0) {
      await redis.del(...all);
    }
  }

  // Test fixture only, not a production default: per 1D.7a (PR #226),
  // `PlatformSetting('policyVersion')` starts null and only gets a real
  // value from publishing a legal text, so nothing seeds it permanently.
  // `getPolicyVersion()` throws when the row is absent or invalid (no
  // fabricated version), and every test here but the one that targets that
  // failure needs some value present to exercise the rest of the endpoint.
  // `update: {}` leaves an existing value (another suite's, on this shared
  // database - see #225) untouched; this only fills the gap when there is
  // none.
  async function ensurePolicyVersionTestFixture(): Promise<void> {
    await prisma.platformSetting.upsert({
      where: { key: 'policyVersion' },
      create: { key: 'policyVersion', value: 'test-fixture-1', updatedByAdminId: null },
      update: {},
    });
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
    await ensurePolicyVersionTestFixture();
  });

  afterEach(async () => {
    await clearRateLimitKeys();
  });

  afterAll(async () => {
    if (createdAnonymousIds.length > 0) {
      await prisma.consentRecord.deleteMany({
        where: { anonymousId: { in: createdAnonymousIds } },
      });
    }
    if (createdUserIds.length > 0) {
      await prisma.consentRecord.deleteMany({ where: { userId: { in: createdUserIds } } });
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    await prisma.$disconnect();
    redis.disconnect();
    await app.close();
  });

  describe('GET /v1/me/consents', () => {
    it('returns 401 without a session', async () => {
      const response = await fastify().inject({ method: 'GET', url: '/v1/me/consents' });
      expect(response.statusCode).toBe(401);
    });

    it('returns every purpose, undecided ones as granted: false with a null policyVersion/recordedAt', async () => {
      const user = await signUpVerifyAndSignIn(`get-${randomUUID().slice(0, 6)}`);

      const response = await fastify().inject({
        method: 'GET',
        url: '/v1/me/consents',
        headers: authHeaders(user.token),
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<ConsentsBody>();
      expect(body.consents).toHaveLength(CONSENT_PURPOSES.length);
      for (const purpose of CONSENT_PURPOSES) {
        const entry = body.consents.find((candidate) => candidate.purpose === purpose);
        expect(entry).toEqual({
          purpose,
          granted: false,
          policyVersion: null,
          recordedAt: null,
        });
      }
    });
  });

  describe('PUT /v1/me/consents', () => {
    it('returns 401 without a session', async () => {
      const response = await fastify().inject({
        method: 'PUT',
        url: '/v1/me/consents',
        headers: { origin: 'http://localhost:3000' },
        payload: { consents: [{ purpose: 'analytics', granted: true }] },
      });
      expect(response.statusCode).toBe(401);
    });

    it('rejects a client-supplied policyVersion', async () => {
      const user = await signUpVerifyAndSignIn(`policy-version-${randomUUID().slice(0, 6)}`);

      const response = await fastify().inject({
        method: 'PUT',
        url: '/v1/me/consents',
        headers: { ...authHeaders(user.token), origin: 'http://localhost:3000' },
        payload: { consents: [{ purpose: 'analytics', granted: true, policyVersion: '99' }] },
      });

      expect(response.statusCode).toBe(400);
    });

    it('appends rather than updates: granting then withdrawing leaves both rows, latest wins', async () => {
      const user = await signUpVerifyAndSignIn(`append-${randomUUID().slice(0, 6)}`);
      const headers = { ...authHeaders(user.token), origin: 'http://localhost:3000' };

      const grant = await fastify().inject({
        method: 'PUT',
        url: '/v1/me/consents',
        headers,
        payload: { consents: [{ purpose: 'analytics', granted: true }] },
      });
      expect(grant.statusCode).toBe(200);
      const afterGrant = grant
        .json<ConsentsBody>()
        .consents.find((entry) => entry.purpose === 'analytics');
      expect(afterGrant?.granted).toBe(true);
      expect(afterGrant?.policyVersion).not.toBeNull();

      const withdraw = await fastify().inject({
        method: 'PUT',
        url: '/v1/me/consents',
        headers,
        payload: { consents: [{ purpose: 'analytics', granted: false }] },
      });
      expect(withdraw.statusCode).toBe(200);
      const afterWithdraw = withdraw
        .json<ConsentsBody>()
        .consents.find((entry) => entry.purpose === 'analytics');
      expect(afterWithdraw?.granted).toBe(false);

      const rows = await prisma.consentRecord.findMany({
        where: { userId: user.id, purpose: 'analytics' },
        orderBy: { recordedAt: 'asc' },
      });
      expect(rows).toHaveLength(2);
      expect(rows[0]?.granted).toBe(true);
      expect(rows[1]?.granted).toBe(false);
    });

    it('never returns ip or userAgent', async () => {
      const user = await signUpVerifyAndSignIn(`no-pii-${randomUUID().slice(0, 6)}`);

      const response = await fastify().inject({
        method: 'PUT',
        url: '/v1/me/consents',
        remoteAddress: FAKE_IP,
        headers: {
          ...authHeaders(user.token),
          origin: 'http://localhost:3000',
          'user-agent': 'photoo-integration-test/1.0',
        },
        payload: { consents: [{ purpose: 'marketing', granted: true }] },
      });

      expect(response.statusCode).toBe(200);
      const raw = JSON.stringify(response.json());
      expect(raw).not.toContain('ip');
      expect(raw).not.toContain('userAgent');
      expect(raw).not.toContain('photoo-integration-test');

      const row = await prisma.consentRecord.findFirstOrThrow({
        where: { userId: user.id, purpose: 'marketing' },
      });
      expect(row.ip).toBe(FAKE_IP);
      expect(row.userAgent).toBe('photoo-integration-test/1.0');
    });

    it('fails loudly and writes nothing when PlatformSetting("policyVersion") is missing', async () => {
      const user = await signUpVerifyAndSignIn(`missing-policy-${randomUUID().slice(0, 6)}`);
      const existing = await prisma.platformSetting.findUnique({
        where: { key: 'policyVersion' },
      });
      await prisma.platformSetting.delete({ where: { key: 'policyVersion' } });

      try {
        const response = await fastify().inject({
          method: 'PUT',
          url: '/v1/me/consents',
          remoteAddress: FAKE_IP,
          headers: { ...authHeaders(user.token), origin: 'http://localhost:3000' },
          payload: { consents: [{ purpose: 'analytics', granted: true }] },
        });

        expect(response.statusCode).toBe(500);
        const rows = await prisma.consentRecord.findMany({ where: { userId: user.id } });
        expect(rows).toHaveLength(0);
      } finally {
        if (existing) {
          await prisma.platformSetting.create({
            data: {
              key: existing.key,
              value: existing.value ?? Prisma.JsonNull,
              updatedByAdminId: existing.updatedByAdminId,
            },
          });
        } else {
          await ensurePolicyVersionTestFixture();
        }
      }
    });
  });

  describe('POST /v1/consents', () => {
    it('records an anonymous choice keyed by anonymousId', async () => {
      const anonymousId = newAnonymousId();

      const response = await fastify().inject({
        method: 'POST',
        url: '/v1/consents',
        remoteAddress: FAKE_IP,
        headers: { origin: 'http://localhost:3000', 'user-agent': 'photoo-anon/1.0' },
        payload: { anonymousId, purpose: 'ads', granted: true },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json<ConsentRecordBody>();
      expect(body.purpose).toBe('ads');
      expect(body.granted).toBe(true);
      expect(body).not.toHaveProperty('ip');
      expect(body).not.toHaveProperty('userAgent');
      expect(body).not.toHaveProperty('anonymousId');

      const row = await prisma.consentRecord.findFirstOrThrow({ where: { anonymousId } });
      expect(row.userId).toBeNull();
      expect(row.ip).toBe(FAKE_IP);
      expect(row.userAgent).toBe('photoo-anon/1.0');
    });

    it('rejects an anonymous call with no anonymousId and no session', async () => {
      const response = await fastify().inject({
        method: 'POST',
        url: '/v1/consents',
        remoteAddress: FAKE_IP,
        headers: { origin: 'http://localhost:3000' },
        payload: { purpose: 'ads', granted: true },
      });
      expect(response.statusCode).toBe(400);
    });

    it('attributes a signed-in call to the session, ignoring any anonymousId in the body', async () => {
      const user = await signUpVerifyAndSignIn(`post-signed-in-${randomUUID().slice(0, 6)}`);
      const suppliedAnonymousId = newAnonymousId();

      const response = await fastify().inject({
        method: 'POST',
        url: '/v1/consents',
        remoteAddress: FAKE_IP,
        headers: { ...authHeaders(user.token), origin: 'http://localhost:3000' },
        payload: { anonymousId: suppliedAnonymousId, purpose: 'marketing', granted: true },
      });

      expect(response.statusCode).toBe(201);
      const row = await prisma.consentRecord.findFirstOrThrow({
        where: { userId: user.id, purpose: 'marketing' },
      });
      expect(row.anonymousId).toBeNull();

      const orphan = await prisma.consentRecord.findFirst({
        where: { anonymousId: suppliedAnonymousId },
      });
      expect(orphan).toBeNull();
    });

    it('cannot read or affect another user’s consent state', async () => {
      const victim = await signUpVerifyAndSignIn(`victim-${randomUUID().slice(0, 6)}`);
      await fastify().inject({
        method: 'PUT',
        url: '/v1/me/consents',
        headers: { ...authHeaders(victim.token), origin: 'http://localhost:3000' },
        payload: { consents: [{ purpose: 'analytics', granted: true }] },
      });

      const attack = await fastify().inject({
        method: 'POST',
        url: '/v1/consents',
        remoteAddress: FAKE_IP,
        headers: { origin: 'http://localhost:3000' },
        payload: { anonymousId: victim.id, purpose: 'analytics', granted: false },
      });
      expect(attack.statusCode).toBe(201);
      expect(attack.json()).not.toHaveProperty('userId');

      const victimState = await fastify().inject({
        method: 'GET',
        url: '/v1/me/consents',
        headers: authHeaders(victim.token),
      });
      const analytics = victimState
        .json<ConsentsBody>()
        .consents.find((entry) => entry.purpose === 'analytics');
      expect(analytics?.granted).toBe(true);

      const victimRows = await prisma.consentRecord.findMany({ where: { userId: victim.id } });
      expect(victimRows).toHaveLength(1);

      const attackerRow = await prisma.consentRecord.findFirst({
        where: { anonymousId: victim.id },
      });
      expect(attackerRow?.userId).toBeNull();
    });

    it('rate limits repeated anonymous posts from the same IP', async () => {
      const rateLimitIp = '10.50.13.2';

      let lastStatus = 0;
      for (let attempt = 0; attempt < 21; attempt += 1) {
        const response = await fastify().inject({
          method: 'POST',
          url: '/v1/consents',
          remoteAddress: rateLimitIp,
          headers: { origin: 'http://localhost:3000' },
          payload: { anonymousId: newAnonymousId(), purpose: 'ads', granted: true },
        });
        lastStatus = response.statusCode;
      }

      expect(lastStatus).toBe(429);
      await redis.del(
        `rate-limit:consents:create:ip:${rateLimitIp}`,
        `lockout:consents:create:ip:${rateLimitIp}`,
      );
    });
  });

  describe('sign-up links anonymous consent records', () => {
    it('attaches pre-sign-in records to the new account by anonymousId', async () => {
      const anonymousId = newAnonymousId();
      await fastify().inject({
        method: 'POST',
        url: '/v1/consents',
        remoteAddress: FAKE_IP,
        headers: { origin: 'http://localhost:3000' },
        payload: { anonymousId, purpose: 'analytics', granted: true },
      });

      const user = await signUpVerifyAndSignIn(`link-${randomUUID().slice(0, 6)}`, anonymousId);

      const response = await fastify().inject({
        method: 'GET',
        url: '/v1/me/consents',
        headers: authHeaders(user.token),
      });
      const analytics = response
        .json<ConsentsBody>()
        .consents.find((entry) => entry.purpose === 'analytics');
      expect(analytics?.granted).toBe(true);

      const row = await prisma.consentRecord.findFirstOrThrow({
        where: { userId: user.id, purpose: 'analytics' },
      });
      expect(row.anonymousId).toBeNull();

      const orphan = await prisma.consentRecord.findFirst({ where: { anonymousId } });
      expect(orphan).toBeNull();
    });

    it('never re-links a record already attached to a different account', async () => {
      const anonymousId = newAnonymousId();
      await fastify().inject({
        method: 'POST',
        url: '/v1/consents',
        remoteAddress: FAKE_IP,
        headers: { origin: 'http://localhost:3000' },
        payload: { anonymousId, purpose: 'ads', granted: true },
      });
      const firstUser = await signUpVerifyAndSignIn(
        `link-first-${randomUUID().slice(0, 6)}`,
        anonymousId,
      );

      // The browser keeps using the same anonymousId after firstUser's
      // account exists, recording a second, still-unlinked choice under it.
      await fastify().inject({
        method: 'POST',
        url: '/v1/consents',
        remoteAddress: FAKE_IP,
        headers: { origin: 'http://localhost:3000' },
        payload: { anonymousId, purpose: 'marketing', granted: true },
      });
      const secondUser = await signUpVerifyAndSignIn(
        `link-second-${randomUUID().slice(0, 6)}`,
        anonymousId,
      );

      const firstUserRows = await prisma.consentRecord.findMany({
        where: { userId: firstUser.id },
      });
      expect(firstUserRows).toHaveLength(1);
      expect(firstUserRows[0]?.purpose).toBe('ads');

      const secondUserRows = await prisma.consentRecord.findMany({
        where: { userId: secondUser.id },
      });
      expect(secondUserRows).toHaveLength(1);
      expect(secondUserRows[0]?.purpose).toBe('marketing');
    });
  });
});
