import { randomUUID } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createPrismaClient, type PrismaClient } from '@photoo/db';
import { Redis } from 'ioredis';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../../testing/create-test-app.js';
import { waitForLinkInEmail } from '../../testing/mailpit.js';
import { requireIntegrationEnv } from '../../testing/require-integration-env.js';
import { TEST_ENV } from '../../testing/test-env.js';
import { StripeConnectService } from './stripe-connect.service.js';

const testEnv = requireIntegrationEnv(['TEST_DATABASE_URL', 'REDIS_URL']);
const PASSWORD = `photoo-test-${randomUUID()}`;
// Distinct per-file IP and coordinates (issue #97): shared Redis and DB with
// other integration suites running in parallel.
const FAKE_IP = '10.50.18.1';
const RUN_ID = randomUUID().replaceAll('-', '').slice(0, 8);
const RUN_SEED = Number.parseInt(RUN_ID, 16);
const RUN_LAT = 35 + (RUN_SEED % 200) / 10;
const RUN_LNG = 35 + (RUN_SEED % 150) / 10;
const ORIGIN = 'http://localhost:3000';

interface StripeAccountBody {
  stripeAccountId: string;
  onboardingComplete: boolean;
  payoutsEnabled: boolean;
}

interface ApiErrorBody {
  code: string;
  message: string;
}

describe('payments (Stripe Connect onboarding) integration', () => {
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

  function headers(token: string) {
    return { authorization: `Bearer ${token}`, origin: ORIGIN };
  }

  async function signUpAndSignIn(
    label: string,
    roles: readonly string[],
  ): Promise<{ token: string; id: string }> {
    const email = `payments-${label}-${randomUUID()}@photoo.test`;
    const signUpResponse = await fastify().inject({
      method: 'POST',
      url: '/v1/auth/sign-up',
      remoteAddress: FAKE_IP,
      payload: { email, password: PASSWORD, roles, locale: 'en' },
    });
    const userId = signUpResponse.json<{ user: { id: string } }>().user.id;
    createdUserIds.push(userId);

    const link = await waitForLinkInEmail(email, /https?:\/\/\S*verify-email#token=\S+/);
    const token = decodeURIComponent(link.slice(link.indexOf('#token=') + '#token='.length));
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
    const body = signInResponse.json<{ user: { id: string }; session: { token: string } | null }>();
    if (!body.session) {
      throw new Error(`sign-in for ${label} did not return a session`);
    }
    return { token: body.session.token, id: body.user.id };
  }

  async function createPhotographer(label: string) {
    const user = await signUpAndSignIn(label, ['photographer']);
    const response = await fastify().inject({
      method: 'POST',
      url: '/v1/me/photographer-profile',
      headers: headers(user.token),
      payload: {
        displayName: `Fx Payments Photog ${label}`,
        categories: ['wedding'],
        languages: ['en'],
        location: { lat: RUN_LAT, lng: RUN_LNG },
        city: `Fx Payments City ${RUN_ID}`,
        countryCode: 'LU',
      },
    });
    expect(response.statusCode).toBe(201);
    return { ...user, profileId: response.json<{ id: string }>().id };
  }

  function createAccount(token: string) {
    return fastify().inject({
      method: 'POST',
      url: '/v1/me/stripe/account',
      remoteAddress: FAKE_IP,
      headers: headers(token),
    });
  }

  function createAccountLink(token: string) {
    return fastify().inject({
      method: 'POST',
      url: '/v1/me/stripe/account-link',
      remoteAddress: FAKE_IP,
      headers: headers(token),
    });
  }

  async function clearRateLimitKeys(): Promise<void> {
    const patterns = [
      `rate-limit:auth:*:${FAKE_IP}`,
      `lockout:auth:*:${FAKE_IP}`,
      ...createdUserIds.map((id) => `rate-limit:payments:*:${id}`),
    ];
    const keys = (await Promise.all(patterns.map((pattern) => redis.keys(pattern)))).flat();
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

  afterEach(async () => {
    await clearRateLimitKeys();
  });

  afterAll(async () => {
    if (createdUserIds.length > 0) {
      const profiles = await prisma.photographerProfile.findMany({
        where: { userId: { in: createdUserIds } },
        select: { id: true },
      });
      await prisma.auditLog.deleteMany({
        where: {
          OR: [
            { actorId: { in: createdUserIds } },
            { targetId: { in: profiles.map((profile) => profile.id) } },
          ],
        },
      });
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    await prisma.$disconnect();
    redis.disconnect();
    await app.close();
  });

  describe('POST /v1/me/stripe/account', () => {
    it('returns 401 without a session', async () => {
      const response = await fastify().inject({
        method: 'POST',
        url: '/v1/me/stripe/account',
        headers: { origin: ORIGIN },
      });
      expect(response.statusCode).toBe(401);
    });

    it('returns 403 for a client', async () => {
      const client = await signUpAndSignIn('client', ['client']);
      const response = await createAccount(client.token);
      expect(response.statusCode).toBe(403);
      expect(response.json<ApiErrorBody>().code).toBe('FORBIDDEN');
    });

    it('returns 404 for a photographer without a profile', async () => {
      const photographer = await signUpAndSignIn('no-profile', ['photographer']);
      const response = await createAccount(photographer.token);
      expect(response.statusCode).toBe(404);
      expect(response.json<ApiErrorBody>().code).toBe('NOT_FOUND');
    });

    it('creates the account once, returns it again with 200, and audits the creation', async () => {
      const photographer = await createPhotographer('create');

      const first = await createAccount(photographer.token);
      expect(first.statusCode).toBe(201);
      const created = first.json<StripeAccountBody>();
      expect(created.stripeAccountId).toMatch(/^acct_/);
      expect(created).toEqual({
        stripeAccountId: created.stripeAccountId,
        onboardingComplete: false,
        payoutsEnabled: false,
      });

      const second = await createAccount(photographer.token);
      expect(second.statusCode).toBe(200);
      expect(second.json<StripeAccountBody>()).toEqual(created);

      const profile = await prisma.photographerProfile.findUniqueOrThrow({
        where: { id: photographer.profileId },
      });
      expect(profile.stripeAccountId).toBe(created.stripeAccountId);

      const audits = await prisma.auditLog.findMany({
        where: { action: 'stripe_account.created', targetId: photographer.profileId },
      });
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({
        actorType: 'user',
        actorId: photographer.id,
        after: { stripeAccountId: created.stripeAccountId },
      });
    });

    it('stores a single account when two creations race', async () => {
      const photographer = await createPhotographer('race');

      const responses = await Promise.all([
        createAccount(photographer.token),
        createAccount(photographer.token),
      ]);

      const ids = responses.map((response) => response.json<StripeAccountBody>().stripeAccountId);
      expect(new Set(ids).size).toBe(1);
      expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 201]);
      const audits = await prisma.auditLog.count({
        where: { action: 'stripe_account.created', targetId: photographer.profileId },
      });
      expect(audits).toBe(1);
    });
  });

  describe('POST /v1/me/stripe/account-link', () => {
    it('returns 409 before the account exists, then an onboarding url', async () => {
      const photographer = await createPhotographer('link');

      const before = await createAccountLink(photographer.token);
      expect(before.statusCode).toBe(409);
      expect(before.json<ApiErrorBody>().code).toBe('CONFLICT');

      await createAccount(photographer.token);
      const after = await createAccountLink(photographer.token);
      expect(after.statusCode).toBe(200);
      expect(after.json<{ url: string }>().url).toMatch(/^https:\/\//);
    });

    it('returns 403 for a client', async () => {
      const client = await signUpAndSignIn('link-client', ['client']);
      const response = await createAccountLink(client.token);
      expect(response.statusCode).toBe(403);
    });
  });

  describe('account.updated handling', () => {
    async function onboardedAccount(label: string) {
      const photographer = await createPhotographer(label);
      const account = (await createAccount(photographer.token)).json<StripeAccountBody>();
      return { ...photographer, accountId: account.stripeAccountId };
    }

    it('mirrors enabled flags without publishing or notifying', async () => {
      const photographer = await onboardedAccount('enable');
      const connect = app.get(StripeConnectService);

      await connect.handleAccountUpdated({
        id: photographer.accountId,
        chargesEnabled: true,
        payoutsEnabled: true,
        detailsSubmitted: true,
      });

      const profile = await prisma.photographerProfile.findUniqueOrThrow({
        where: { id: photographer.profileId },
      });
      expect(profile).toMatchObject({
        stripeOnboardingComplete: true,
        stripePayoutsEnabled: true,
        isPublished: false,
      });
      expect(
        await prisma.auditLog.count({
          where: { action: 'stripe_account.updated', targetId: photographer.profileId },
        }),
      ).toBe(1);
      expect(
        await prisma.notification.count({
          where: { userId: photographer.id, type: 'payouts_disabled' },
        }),
      ).toBe(0);
    });

    it('unpublishes and notifies once when payouts get disabled, even when replayed', async () => {
      const photographer = await onboardedAccount('disable');
      await prisma.photographerProfile.update({
        where: { id: photographer.profileId },
        data: {
          verificationStatus: 'verified',
          stripeOnboardingComplete: true,
          stripePayoutsEnabled: true,
          isPublished: true,
        },
      });
      const connect = app.get(StripeConnectService);
      const disabled = {
        id: photographer.accountId,
        chargesEnabled: true,
        payoutsEnabled: false,
        detailsSubmitted: true,
      };

      await connect.handleAccountUpdated(disabled);
      await connect.handleAccountUpdated(disabled);

      const profile = await prisma.photographerProfile.findUniqueOrThrow({
        where: { id: photographer.profileId },
      });
      expect(profile).toMatchObject({ stripePayoutsEnabled: false, isPublished: false });
      const audits = await prisma.auditLog.findMany({
        where: { action: 'stripe_account.updated', targetId: photographer.profileId },
      });
      expect(audits).toHaveLength(1);
      expect(audits[0]?.after).toMatchObject({ stripePayoutsEnabled: false, isPublished: false });
      expect(
        await prisma.notification.count({
          where: { userId: photographer.id, type: 'payouts_disabled' },
        }),
      ).toBe(1);
    });

    it('ignores an unknown account id', async () => {
      const connect = app.get(StripeConnectService);
      await expect(
        connect.handleAccountUpdated({
          id: `acct_unknown_${RUN_ID}`,
          chargesEnabled: true,
          payoutsEnabled: true,
          detailsSubmitted: true,
        }),
      ).resolves.toBeUndefined();
    });
  });
});
