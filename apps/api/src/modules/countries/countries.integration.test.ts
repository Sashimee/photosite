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
const FAKE_IP = '10.50.13.1';
const RUN_ID = randomUUID().replaceAll('-', '').slice(0, 8);

interface CountryBody {
  code: string;
  name: string;
  currency: string;
  defaultLocale: string;
}

interface AdminCountryBody {
  code: string;
  name: string;
  enabled: boolean;
  currency: string;
  vatRate: number;
  defaultLocale: string;
  accountCount: number;
}

interface LegalTextVersionBody {
  version: string;
  kind: string;
  locale: string;
  content: string;
  publishedAt: string;
  publishedByAdminId: string;
}

interface LegalTextsBody {
  countryCode: string;
  versions: LegalTextVersionBody[];
}

describe('countries integration', () => {
  if (!testEnv) {
    it.skip('skipped: TEST_DATABASE_URL or REDIS_URL is not set', () => undefined);
    return;
  }

  let app: NestFastifyApplication;
  let prisma: PrismaClient;
  let redis: Redis;
  const createdUserIds: string[] = [];
  const createdCountryCodes: string[] = [];

  function fastify() {
    return app.getHttpAdapter().getInstance();
  }

  function authHeaders(token: string) {
    return { authorization: `Bearer ${token}` };
  }

  function uniqueEmail(label: string): string {
    return `countries-${label}-${randomUUID()}@photoo.test`;
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

  // Mirrors admin.integration.test.ts's makeAdmin: every admin session needs
  // a verified second factor (requireAdminSession).
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

  // Starting from 'M' keeps every generated code alphabetically after the
  // seeded 'LU', so it can never become auth's default-country pick
  // (`ORDER BY code ASC LIMIT 1` over enabled countries) for a sign-up
  // racing in another test file against the same database. Stopping at 'Y'
  // keeps 'ZZ' free as the never-existing code other tests rely on.
  function randomCountryCode(): string {
    const pick = () => String.fromCharCode(77 + Math.floor(Math.random() * 13));
    return `${pick()}${pick()}`;
  }

  // Two-letter country codes only give 676 combinations, so a fresh random
  // draw can collide with a leftover row from a previous run; retrying on
  // the unique-constraint violation is simpler than a global counter shared
  // across concurrently running test files.
  async function createTestCountry(overrides: Record<string, unknown> = {}): Promise<string> {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const code = randomCountryCode();
      try {
        await prisma.country.create({
          data: {
            code,
            name: `Fixture Country ${RUN_ID}`,
            enabled: true,
            currency: 'EUR',
            vatRate: 15,
            requiredDocuments: [],
            legalTexts: {},
            defaultLocale: 'en',
            ...overrides,
          },
        });
        createdCountryCodes.push(code);
        return code;
      } catch {
        continue;
      }
    }
    throw new Error('createTestCountry: could not find an unused country code');
  }

  function requestPayload(countryCode: string, overrides: Record<string, unknown> = {}) {
    const eventDate = new Date();
    eventDate.setUTCDate(eventDate.getUTCDate() + 30);
    return {
      title: 'Looking for a photographer',
      category: 'wedding',
      description: 'Full day coverage needed.',
      eventDate: eventDate.toISOString(),
      dateFlexible: false,
      location: { lat: 10, lng: 10 },
      address: {
        line1: '1 Fixture Way',
        city: `Fx City ${RUN_ID}`,
        postalCode: '00000',
        countryCode,
      },
      budgetMin: { amountCents: 100000, currency: 'EUR' },
      budgetMax: { amountCents: 200000, currency: 'EUR' },
      usage: 'personal',
      ...overrides,
    };
  }

  async function createRequestAs(token: string, countryCode: string) {
    const response = await fastify().inject({
      method: 'POST',
      url: '/v1/requests',
      remoteAddress: FAKE_IP,
      headers: authHeaders(token),
      payload: requestPayload(countryCode),
    });
    return response;
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
    if (createdCountryCodes.length > 0) {
      await prisma.request.deleteMany({ where: { countryCode: { in: createdCountryCodes } } });
      await prisma.user.deleteMany({ where: { countryCode: { in: createdCountryCodes } } });
      await prisma.country.deleteMany({ where: { code: { in: createdCountryCodes } } });
    }
    if (createdUserIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    await prisma.$disconnect();
    redis.disconnect();
    await app.close();
  });

  describe('GET /v1/countries', () => {
    it('sets a 1 hour public Cache-Control header', async () => {
      const response = await fastify().inject({ method: 'GET', url: '/v1/countries' });
      expect(response.statusCode).toBe(200);
      expect(response.headers['cache-control']).toBe('public, max-age=3600');
    });

    it('includes the seeded, enabled Luxembourg row with its public fields', async () => {
      const response = await fastify().inject({ method: 'GET', url: '/v1/countries' });
      const body = response.json<CountryBody[]>();
      const lu = body.find((country) => country.code === 'LU');
      expect(lu).toMatchObject({
        code: 'LU',
        name: 'Luxembourg',
        currency: 'EUR',
        defaultLocale: 'fr',
      });
    });

    it('never exposes internal country configuration', async () => {
      const response = await fastify().inject({ method: 'GET', url: '/v1/countries' });
      const body = response.json<Record<string, unknown>[]>();
      for (const country of body) {
        expect(country).not.toHaveProperty('vatRate');
        expect(country).not.toHaveProperty('requiredDocuments');
        expect(country).not.toHaveProperty('legalTexts');
        expect(country).not.toHaveProperty('enabled');
      }
    });
  });

  describe('GET /v1/policy-version', () => {
    it('returns null when nothing has been published yet', async () => {
      const existing = await prisma.platformSetting.findUnique({ where: { key: 'policyVersion' } });
      if (existing) {
        return;
      }
      const response = await fastify().inject({ method: 'GET', url: '/v1/policy-version' });
      expect(response.statusCode).toBe(200);
      expect(response.json<{ policyVersion: string | null }>().policyVersion).toBeNull();
    });
  });

  describe('GET /v1/admin/countries', () => {
    it('returns 403 for an admin without the superadmin permission', async () => {
      const admin = await makeAdmin('countries-list-no-permission', ['support']);
      const response = await fastify().inject({
        method: 'GET',
        url: '/v1/admin/countries',
        headers: admin.headers,
      });
      expect(response.statusCode).toBe(403);
    });

    it('lists every country, including disabled ones, with an account count', async () => {
      const code = await createTestCountry({ enabled: false });
      const admin = await makeAdmin('countries-list-ok', ['superadmin']);
      const response = await fastify().inject({
        method: 'GET',
        url: '/v1/admin/countries',
        headers: admin.headers,
      });
      expect(response.statusCode).toBe(200);
      const body = response.json<AdminCountryBody[]>();
      const fixture = body.find((country) => country.code === code);
      expect(fixture).toMatchObject({ code, enabled: false, accountCount: 0 });
      const lu = body.find((country) => country.code === 'LU');
      expect(lu?.enabled).toBe(true);
      expect(typeof lu?.accountCount).toBe('number');
    });
  });

  describe('PATCH /v1/admin/countries/:code', () => {
    it('returns 403 for an admin without the superadmin permission', async () => {
      const code = await createTestCountry();
      const admin = await makeAdmin('countries-patch-no-permission', ['support']);
      const response = await fastify().inject({
        method: 'PATCH',
        url: `/v1/admin/countries/${code}`,
        headers: admin.headers,
        payload: { enabled: false },
      });
      expect(response.statusCode).toBe(403);
    });

    it('returns 404 for an unknown country code', async () => {
      const admin = await makeAdmin('countries-patch-404', ['superadmin']);
      const response = await fastify().inject({
        method: 'PATCH',
        url: '/v1/admin/countries/ZZ',
        headers: admin.headers,
        payload: { enabled: false },
      });
      expect(response.statusCode).toBe(404);
    });

    it('updates enabled, vatRate and defaultLocale, and records the old and new value', async () => {
      const code = await createTestCountry({ vatRate: 15, defaultLocale: 'en' });
      const admin = await makeAdmin('countries-patch-ok', ['superadmin']);

      const response = await fastify().inject({
        method: 'PATCH',
        url: `/v1/admin/countries/${code}`,
        headers: admin.headers,
        remoteAddress: FAKE_IP,
        payload: { enabled: false, vatRate: 20, defaultLocale: 'fr' },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json<AdminCountryBody>();
      expect(body).toMatchObject({ code, enabled: false, vatRate: 20, defaultLocale: 'fr' });

      const auditRow = await prisma.auditLog.findFirst({
        where: { action: 'country.updated', targetId: code },
        orderBy: { occurredAt: 'desc' },
      });
      expect(auditRow).not.toBeNull();
      expect((auditRow?.before as { enabled?: boolean } | null)?.enabled).toBe(true);
      expect((auditRow?.after as { enabled?: boolean } | null)?.enabled).toBe(false);

      const auditLogResponse = await fastify().inject({
        method: 'GET',
        url: `/v1/admin/audit-log?entityType=Country&targetId=${code}`,
        headers: admin.headers,
      });
      expect(auditLogResponse.statusCode).toBe(200);
      const auditLogBody = auditLogResponse.json<{ items: { targetId: string | null }[] }>();
      expect(auditLogBody.items.some((entry) => entry.targetId === code)).toBe(true);
    });

    // docs/steps/1D.7-settings.md: disabling a country gates new sign-ups,
    // profiles and requests in it; it never hides existing users or breaks
    // their bookings.
    it('blocks a new request in a disabled country while an existing one keeps working', async () => {
      const code = await createTestCountry();
      const client = await signUpVerifyAndSignIn(['client'], 'countries-disable-client');
      await prisma.user.update({ where: { id: client.id }, data: { countryCode: code } });

      const existingRequest = await createRequestAs(client.token, code);
      expect(existingRequest.statusCode).toBe(201);
      const existingRequestId = existingRequest.json<{ id: string }>().id;

      const admin = await makeAdmin('countries-disable-admin', ['superadmin']);
      const disableResponse = await fastify().inject({
        method: 'PATCH',
        url: `/v1/admin/countries/${code}`,
        headers: admin.headers,
        payload: { enabled: false },
      });
      expect(disableResponse.statusCode).toBe(200);

      const blockedRequest = await createRequestAs(client.token, code);
      expect(blockedRequest.statusCode).toBe(422);

      const stillReadable = await fastify().inject({
        method: 'GET',
        url: `/v1/requests/${existingRequestId}`,
        headers: authHeaders(client.token),
      });
      expect(stillReadable.statusCode).toBe(200);
    });
  });

  describe('GET and POST /v1/admin/countries/:code/legal-texts', () => {
    it('returns 403 for an admin without the superadmin permission', async () => {
      const code = await createTestCountry();
      const admin = await makeAdmin('legal-texts-no-permission', ['support']);
      const response = await fastify().inject({
        method: 'GET',
        url: `/v1/admin/countries/${code}/legal-texts`,
        headers: admin.headers,
      });
      expect(response.statusCode).toBe(403);
    });

    it('returns 404 for an unknown country code', async () => {
      const admin = await makeAdmin('legal-texts-404', ['superadmin']);
      const response = await fastify().inject({
        method: 'GET',
        url: '/v1/admin/countries/ZZ/legal-texts',
        headers: admin.headers,
      });
      expect(response.statusCode).toBe(404);
    });

    it('starts with no versions, then publishes append-only, never overwriting an earlier version', async () => {
      const code = await createTestCountry();
      const admin = await makeAdmin('legal-texts-publish', ['superadmin']);

      const empty = await fastify().inject({
        method: 'GET',
        url: `/v1/admin/countries/${code}/legal-texts`,
        headers: admin.headers,
      });
      expect(empty.json<LegalTextsBody>().versions).toEqual([]);

      const first = await fastify().inject({
        method: 'POST',
        url: `/v1/admin/countries/${code}/legal-texts`,
        headers: admin.headers,
        remoteAddress: FAKE_IP,
        payload: { kind: 'terms', locale: 'en', content: 'Version one.' },
      });
      expect(first.statusCode).toBe(201);
      expect(first.json<LegalTextsBody>().versions).toHaveLength(1);

      const second = await fastify().inject({
        method: 'POST',
        url: `/v1/admin/countries/${code}/legal-texts`,
        headers: admin.headers,
        remoteAddress: FAKE_IP,
        payload: { kind: 'terms', locale: 'en', content: 'Version two.' },
      });
      expect(second.statusCode).toBe(201);
      const versions = second.json<LegalTextsBody>().versions;
      expect(versions).toHaveLength(2);
      expect(versions[0]).toMatchObject({ version: '1', content: 'Version one.' });
      expect(versions[1]).toMatchObject({ version: '2', content: 'Version two.' });

      const auditRows = await prisma.auditLog.findMany({
        where: { action: 'country.legal_text_published', targetId: code },
      });
      expect(auditRows).toHaveLength(2);

      const policyVersion = await fastify().inject({
        method: 'GET',
        url: '/v1/policy-version',
      });
      expect(policyVersion.json<{ policyVersion: string | null }>().policyVersion).not.toBeNull();
    });
  });
});
