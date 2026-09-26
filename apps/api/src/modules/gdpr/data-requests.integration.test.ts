import { randomUUID } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createPrismaClient, type PrismaClient } from '@photoo/db';
import { GDPR_DELETION_GRACE_PERIOD_MS } from '@photoo/shared';
import { Redis } from 'ioredis';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../../testing/create-test-app.js';
import { waitForLinkInEmail } from '../../testing/mailpit.js';
import { requireIntegrationEnv } from '../../testing/require-integration-env.js';
import { TEST_ENV } from '../../testing/test-env.js';

const testEnv = requireIntegrationEnv(['TEST_DATABASE_URL', 'REDIS_URL']);
const PASSWORD = `photoo-test-${randomUUID()}`;
// Distinct per-file IP and coordinates (issue #97): shared Redis and DB with
// other integration suites running in parallel.
const FAKE_IP = '10.50.14.1';
const RUN_ID = randomUUID().replaceAll('-', '').slice(0, 8);
const RUN_SEED = Number.parseInt(RUN_ID, 16);
const RUN_LAT = 30 + (RUN_SEED % 200) / 10;
const RUN_LNG = 30 + (RUN_SEED % 150) / 10;

function extractFragmentToken(link: string): string | null {
  const hashIndex = link.indexOf('#token=');
  if (hashIndex === -1) {
    return null;
  }
  return decodeURIComponent(link.slice(hashIndex + '#token='.length));
}

function uniqueEmail(label: string): string {
  return `data-requests-${label}-${randomUUID()}@photoo.test`;
}

interface DataRequestBody {
  id: string;
  type: string;
  status: string;
  channel: string;
  requestedAt: string;
  receivedAt: string;
  completedAt: string | null;
  expiresAt: string | null;
  failureReason: string | null;
  cancelledAt: string | null;
}

interface ApiErrorBody {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

interface RequestBody {
  id: string;
}

interface ProductBody {
  id: string;
  tiers: { id: string }[];
}

describe('data requests integration', () => {
  if (!testEnv) {
    it.skip('skipped: TEST_DATABASE_URL or REDIS_URL is not set', () => undefined);
    return;
  }

  let app: NestFastifyApplication;
  let prisma: PrismaClient;
  let redis: Redis;
  const createdUserIds: string[] = [];
  const createdProfileIds: string[] = [];

  function fastify() {
    return app.getHttpAdapter().getInstance();
  }

  function authHeaders(token: string) {
    return { authorization: `Bearer ${token}` };
  }

  async function signUpAndSignIn(
    label: string,
    roles: readonly string[],
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

    return signInAs(email);
  }

  async function signInAs(email: string): Promise<{ token: string; id: string; email: string }> {
    const signInResponse = await fastify().inject({
      method: 'POST',
      url: '/v1/auth/sign-in',
      remoteAddress: FAKE_IP,
      payload: { email, password: PASSWORD },
    });
    const body = signInResponse.json<{ user: { id: string }; session: { token: string } | null }>();
    if (!body.session) {
      throw new Error(`sign-in for ${email} did not return a session: ${JSON.stringify(body)}`);
    }
    return { token: body.session.token, id: body.user.id, email };
  }

  async function createPublishedPhotographer(
    suffix: string,
    roles: readonly string[] = ['photographer'],
  ): Promise<{ token: string; userId: string; profileId: string; slug: string; email: string }> {
    const user = await signUpAndSignIn(suffix, roles);
    const createResponse = await fastify().inject({
      method: 'POST',
      url: '/v1/me/photographer-profile',
      headers: authHeaders(user.token),
      payload: {
        displayName: `Fx GDPR Photog ${suffix}`,
        categories: ['wedding'],
        languages: ['en'],
        location: { lat: RUN_LAT, lng: RUN_LNG },
        city: `Fx GDPR City ${suffix}`,
        countryCode: 'LU',
      },
    });
    const profile = createResponse.json<{ id: string; slug: string }>();
    await prisma.photographerProfile.update({
      where: { id: profile.id },
      data: {
        verificationStatus: 'verified',
        stripeAccountId: `acct_${profile.id}`,
        stripeOnboardingComplete: true,
        stripePayoutsEnabled: true,
        isPublished: true,
      },
    });
    createdProfileIds.push(profile.id);
    return {
      token: user.token,
      userId: user.id,
      profileId: profile.id,
      slug: profile.slug,
      email: user.email,
    };
  }

  async function createProduct(photographerToken: string): Promise<ProductBody> {
    const response = await fastify().inject({
      method: 'POST',
      url: '/v1/me/products',
      headers: authHeaders(photographerToken),
      payload: {
        title: { en: 'GDPR fixture package' },
        category: 'wedding',
        durationMinutes: 120,
        deliverables: { photos: 100, editedPhotos: 50, turnaroundDays: 10, onlineGallery: true },
        basePrice: { amountCents: 40000, currency: 'EUR' },
        tiers: [
          {
            usage: 'personal',
            price: { amountCents: 40000, currency: 'EUR' },
            description: 'Personal use',
            licenceTextVersion: 'v1',
          },
        ],
      },
    });
    return response.json<ProductBody>();
  }

  function futureIso(daysFromNow: number): string {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() + daysFromNow);
    return date.toISOString();
  }

  function requestPayload(overrides: Record<string, unknown> = {}) {
    return {
      title: 'Looking for a photographer',
      category: 'wedding',
      description: 'Fixture request for the GDPR data-requests suite.',
      eventDate: futureIso(30),
      dateFlexible: false,
      location: { lat: RUN_LAT, lng: RUN_LNG },
      address: {
        line1: '1 Fixture Way',
        city: `Fx GDPR City ${RUN_ID}`,
        postalCode: 'L-1000',
        countryCode: 'LU',
      },
      budgetMin: { amountCents: 100000, currency: 'EUR' },
      budgetMax: { amountCents: 200000, currency: 'EUR' },
      usage: 'personal',
      ...overrides,
    };
  }

  async function createRequestAs(token: string): Promise<RequestBody> {
    const response = await fastify().inject({
      method: 'POST',
      url: '/v1/requests',
      remoteAddress: FAKE_IP,
      headers: authHeaders(token),
      payload: requestPayload(),
    });
    return response.json<RequestBody>();
  }

  async function sendQuote(photographerToken: string, requestId: string) {
    return fastify().inject({
      method: 'POST',
      url: '/v1/quotes',
      remoteAddress: FAKE_IP,
      headers: authHeaders(photographerToken),
      payload: {
        requestId,
        lineItems: [{ label: 'Coverage', qty: 1, unitCents: 40000 }],
        validUntil: futureIso(5),
      },
    });
  }

  async function requestDirectQuote(clientToken: string, slug: string, product: ProductBody) {
    return fastify().inject({
      method: 'POST',
      url: `/v1/photographers/${slug}/products/${product.id}/quotes`,
      remoteAddress: FAKE_IP,
      headers: authHeaders(clientToken),
      payload: { productTierId: product.tiers[0]?.id },
    });
  }

  async function clearRateLimitKeys(): Promise<void> {
    const patterns = [`rate-limit:auth:*:${FAKE_IP}`, `lockout:auth:*:${FAKE_IP}`];
    const exact = createdUserIds.flatMap((id) => [
      `rate-limit:gdpr:export:account:${id}`,
      `lockout:gdpr:export:account:${id}`,
    ]);
    const globbed = (await Promise.all(patterns.map((pattern) => redis.keys(pattern)))).flat();
    const all = [...globbed, ...exact];
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
    if (createdUserIds.length > 0 || createdProfileIds.length > 0) {
      await prisma.conversation.deleteMany({
        where: { type: 'quote', participants: { some: { userId: { in: createdUserIds } } } },
      });
      await prisma.quote.deleteMany({
        where: {
          OR: [{ clientId: { in: createdUserIds } }, { photographerId: { in: createdProfileIds } }],
        },
      });
      await prisma.request.deleteMany({ where: { clientId: { in: createdUserIds } } });
      await prisma.dataRequest.deleteMany({ where: { userId: { in: createdUserIds } } });
      await prisma.verificationCase.deleteMany({ where: { userId: { in: createdUserIds } } });
      await prisma.auditLog.deleteMany({ where: { actorId: { in: createdUserIds } } });
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    await prisma.$disconnect();
    redis.disconnect();
    await app.close();
  });

  describe('POST /v1/me/data-requests', () => {
    it('returns 401 without a session', async () => {
      const response = await fastify().inject({
        method: 'POST',
        url: '/v1/me/data-requests',
        headers: { origin: 'http://localhost:3000' },
        payload: { type: 'export' },
      });
      expect(response.statusCode).toBe(401);
    });

    describe('export', () => {
      it('works for an unverified account: GDPR export is not gated by email verification', async () => {
        const user = await signUpAndSignIn('export-unverified', ['client']);
        await prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: null } });
        const headers = { ...authHeaders(user.token), origin: 'http://localhost:3000' };

        const response = await fastify().inject({
          method: 'POST',
          url: '/v1/me/data-requests',
          headers,
          payload: { type: 'export' },
        });
        expect(response.statusCode).toBe(201);
      });

      it('creates a pending export, and a second call returns the same row', async () => {
        const user = await signUpAndSignIn('export-idempotent', ['client']);
        const headers = { ...authHeaders(user.token), origin: 'http://localhost:3000' };

        const first = await fastify().inject({
          method: 'POST',
          url: '/v1/me/data-requests',
          headers,
          payload: { type: 'export' },
        });
        expect(first.statusCode).toBe(201);
        const firstBody = first.json<DataRequestBody>();
        expect(firstBody.type).toBe('export');
        expect(firstBody.status).toBe('pending');

        const second = await fastify().inject({
          method: 'POST',
          url: '/v1/me/data-requests',
          headers,
          payload: { type: 'export' },
        });
        expect(second.statusCode).toBe(200);
        expect(second.json<DataRequestBody>().id).toBe(firstBody.id);

        const rows = await prisma.dataRequest.findMany({ where: { userId: user.id } });
        expect(rows).toHaveLength(1);
      });

      it('limits a new export to one per 24 hours once the previous one is no longer open', async () => {
        const user = await signUpAndSignIn('export-rate-limit', ['client']);
        const headers = { ...authHeaders(user.token), origin: 'http://localhost:3000' };

        const first = await fastify().inject({
          method: 'POST',
          url: '/v1/me/data-requests',
          headers,
          payload: { type: 'export' },
        });
        const firstBody = first.json<DataRequestBody>();

        await prisma.dataRequest.update({
          where: { id: firstBody.id },
          data: { status: 'ready', completedAt: new Date(), exportKey: 'exports/fixture.zip' },
        });

        const second = await fastify().inject({
          method: 'POST',
          url: '/v1/me/data-requests',
          headers,
          payload: { type: 'export' },
        });
        expect(second.statusCode).toBe(429);
        const body = second.json<ApiErrorBody>();
        expect(body.details?.retryAfterSeconds).toBeGreaterThan(0);
      });
    });

    describe('delete', () => {
      it('deletes immediately: sessions, devices, publish state and outstanding work', async () => {
        const mainUser = await signUpAndSignIn('delete-main', ['client', 'photographer']);
        const secondSession = await signInAs(mainUser.email);

        const mainProfile = await fastify().inject({
          method: 'POST',
          url: '/v1/me/photographer-profile',
          headers: authHeaders(mainUser.token),
          payload: {
            displayName: 'Fx GDPR Deletable',
            categories: ['wedding'],
            languages: ['en'],
            location: { lat: RUN_LAT, lng: RUN_LNG },
            city: `Fx GDPR City ${RUN_ID}`,
            countryCode: 'LU',
          },
        });
        const mainProfileBody = mainProfile.json<{ id: string; slug: string }>();
        await prisma.photographerProfile.update({
          where: { id: mainProfileBody.id },
          data: {
            verificationStatus: 'verified',
            stripeAccountId: `acct_${mainProfileBody.id}`,
            stripeOnboardingComplete: true,
            stripePayoutsEnabled: true,
            isPublished: true,
          },
        });
        createdProfileIds.push(mainProfileBody.id);

        await fastify().inject({
          method: 'POST',
          url: '/v1/me/devices',
          headers: authHeaders(mainUser.token),
          payload: { expoPushToken: `ExponentPushToken[${randomUUID()}]`, platform: 'ios' },
        });

        const photographerB = await createPublishedPhotographer('delete-b');
        const mainRequest = await createRequestAs(mainUser.token);
        const quoteFromB = await sendQuote(photographerB.token, mainRequest.id);
        const quoteFromBId = quoteFromB.json<{ id: string }>().id;

        const photographerC = await createPublishedPhotographer('delete-c');
        const productC = await createProduct(photographerC.token);
        const directQuote = await requestDirectQuote(mainUser.token, photographerC.slug, productC);
        const directQuoteId = directQuote.json<{ id: string }>().id;

        const clientD = await signUpAndSignIn('delete-d', ['client']);
        const requestD = await createRequestAs(clientD.token);
        const quoteToD = await sendQuote(mainUser.token, requestD.id);
        const quoteToDId = quoteToD.json<{ id: string }>().id;

        const deleteResponse = await fastify().inject({
          method: 'POST',
          url: '/v1/me/data-requests',
          headers: { ...authHeaders(mainUser.token), origin: 'http://localhost:3000' },
          payload: { type: 'delete' },
        });
        expect(deleteResponse.statusCode).toBe(201);
        const deleteBody = deleteResponse.json<DataRequestBody>();
        expect(deleteBody.type).toBe('delete');
        expect(deleteBody.channel).toBe('in_app');
        expect(
          Math.abs(
            new Date(deleteBody.requestedAt).getTime() - new Date(deleteBody.receivedAt).getTime(),
          ),
        ).toBeLessThan(1_000);
        expect(Date.now() - new Date(deleteBody.requestedAt).getTime()).toBeLessThan(10_000);

        const deletionAuditRow = await prisma.auditLog.findFirst({
          where: { action: 'data_request.deletion_requested', targetId: deleteBody.id },
        });
        expect(deletionAuditRow).not.toBeNull();
        expect(deletionAuditRow?.targetType).toBe('DataRequest');
        expect(
          await prisma.auditLog.findFirst({
            where: { action: 'data_request.logged_offline', targetId: deleteBody.id },
          }),
        ).toBeNull();

        const deletedUser = await prisma.user.findUniqueOrThrow({ where: { id: mainUser.id } });
        expect(deletedUser.status).toBe('deleted');
        expect(deletedUser.deletedAt).not.toBeNull();

        const sessions = await prisma.session.findMany({ where: { userId: mainUser.id } });
        expect(sessions).toHaveLength(0);
        const devices = await prisma.device.findMany({ where: { userId: mainUser.id } });
        expect(devices).toHaveLength(0);

        const profileAfter = await prisma.photographerProfile.findUniqueOrThrow({
          where: { id: mainProfileBody.id },
        });
        expect(profileAfter.isPublished).toBe(false);

        const requestAfter = await prisma.request.findUniqueOrThrow({
          where: { id: mainRequest.id },
        });
        expect(requestAfter.status).toBe('cancelled');

        const quoteFromBAfter = await prisma.quote.findUniqueOrThrow({
          where: { id: quoteFromBId },
        });
        expect(quoteFromBAfter.status).toBe('declined');

        const directQuoteAfter = await prisma.quote.findUniqueOrThrow({
          where: { id: directQuoteId },
        });
        expect(directQuoteAfter.status).toBe('declined');

        const quoteToDAfter = await prisma.quote.findUniqueOrThrow({ where: { id: quoteToDId } });
        expect(quoteToDAfter.status).toBe('withdrawn');

        const authedAfterDeletion = await fastify().inject({
          method: 'GET',
          url: '/v1/me/data-requests',
          headers: authHeaders(secondSession.token),
        });
        expect(authedAfterDeletion.statusCode).toBe(401);
      });

      it('works for an unverified account: GDPR deletion is not gated by email verification', async () => {
        const user = await signUpAndSignIn('delete-unverified', ['client']);
        await prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: null } });

        const response = await fastify().inject({
          method: 'POST',
          url: '/v1/me/data-requests',
          headers: { ...authHeaders(user.token), origin: 'http://localhost:3000' },
          payload: { type: 'delete' },
        });
        expect(response.statusCode).toBe(201);
      });

      it('returns the existing row on a second call', async () => {
        const user = await signUpAndSignIn('delete-idempotent', ['client']);
        const headers = { ...authHeaders(user.token), origin: 'http://localhost:3000' };

        const first = await fastify().inject({
          method: 'POST',
          url: '/v1/me/data-requests',
          headers,
          payload: { type: 'delete' },
        });
        expect(first.statusCode).toBe(201);
        const firstBody = first.json<DataRequestBody>();

        const secondSession = await signInAs(user.email).catch(() => null);
        expect(secondSession).toBeNull();

        const rows = await prisma.dataRequest.findMany({ where: { userId: user.id } });
        expect(rows).toHaveLength(1);
        expect(rows[0]?.id).toBe(firstBody.id);
      });

      it('is blocked by an in-review verification case, and changes nothing', async () => {
        const photographer = await createPublishedPhotographer('delete-blocked-verification');
        await prisma.verificationCase.create({
          data: {
            userId: photographer.userId,
            countryCode: 'LU',
            status: 'in_review',
          },
        });

        const response = await fastify().inject({
          method: 'POST',
          url: '/v1/me/data-requests',
          headers: { ...authHeaders(photographer.token), origin: 'http://localhost:3000' },
          payload: { type: 'delete' },
        });
        expect(response.statusCode).toBe(409);
        expect(response.json<ApiErrorBody>().details?.reason).toBe('VERIFICATION_IN_REVIEW');

        const user = await prisma.user.findUniqueOrThrow({ where: { id: photographer.userId } });
        expect(user.status).toBe('active');
        const rows = await prisma.dataRequest.findMany({ where: { userId: photographer.userId } });
        expect(rows).toHaveLength(0);
      });

      it('is blocked by a quote accepted inside the withdrawal window, and changes nothing', async () => {
        const client = await signUpAndSignIn('delete-blocked-quote', ['client']);
        const photographer = await createPublishedPhotographer('delete-blocked-quote-photog');
        const request = await createRequestAs(client.token);
        const sent = await sendQuote(photographer.token, request.id);
        const quoteId = sent.json<{ id: string }>().id;

        await fastify().inject({
          method: 'POST',
          url: `/v1/quotes/${quoteId}/accept`,
          headers: authHeaders(client.token),
        });

        const response = await fastify().inject({
          method: 'POST',
          url: '/v1/me/data-requests',
          headers: { ...authHeaders(client.token), origin: 'http://localhost:3000' },
          payload: { type: 'delete' },
        });
        expect(response.statusCode).toBe(409);
        expect(response.json<ApiErrorBody>().details?.reason).toBe(
          'ACCEPTED_QUOTE_WITHDRAWAL_WINDOW',
        );

        const user = await prisma.user.findUniqueOrThrow({ where: { id: client.id } });
        expect(user.status).toBe('active');
      });
    });
  });

  describe('GET /v1/me/data-requests', () => {
    it('returns 401 without a session', async () => {
      const response = await fastify().inject({ method: 'GET', url: '/v1/me/data-requests' });
      expect(response.statusCode).toBe(401);
    });
  });

  describe('GET /v1/me/data-requests/:id', () => {
    it('returns 404 for another account’s request', async () => {
      const owner = await signUpAndSignIn('get-owner', ['client']);
      const stranger = await signUpAndSignIn('get-stranger', ['client']);

      const created = await fastify().inject({
        method: 'POST',
        url: '/v1/me/data-requests',
        headers: { ...authHeaders(owner.token), origin: 'http://localhost:3000' },
        payload: { type: 'export' },
      });
      const id = created.json<DataRequestBody>().id;

      const response = await fastify().inject({
        method: 'GET',
        url: `/v1/me/data-requests/${id}`,
        headers: authHeaders(stranger.token),
      });
      expect(response.statusCode).toBe(404);
    });
  });

  describe('POST /v1/me/data-requests/:id/cancel', () => {
    it('cancels via the emailed token and restores the account', async () => {
      const user = await signUpAndSignIn('cancel-token', ['client']);

      const created = await fastify().inject({
        method: 'POST',
        url: '/v1/me/data-requests',
        headers: { ...authHeaders(user.token), origin: 'http://localhost:3000' },
        payload: { type: 'delete' },
      });
      const dataRequestId = created.json<DataRequestBody>().id;

      const link = await waitForLinkInEmail(
        user.email,
        /https?:\/\/\S*account\/deletion\/cancel\/\S+#token=\S+/,
      );
      const token = extractFragmentToken(link);
      expect(token).not.toBeNull();

      const cancelResponse = await fastify().inject({
        method: 'POST',
        url: `/v1/me/data-requests/${dataRequestId}/cancel`,
        headers: { origin: 'http://localhost:3000' },
        payload: { token },
      });
      expect(cancelResponse.statusCode).toBe(200);
      expect(cancelResponse.json<DataRequestBody>().status).toBe('cancelled');

      const restored = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(restored.status).toBe('active');
      expect(restored.deletedAt).toBeNull();

      const signedInAgain = await signInAs(user.email);
      expect(signedInAgain.id).toBe(user.id);
    });

    it('returns 401 with no session and no token', async () => {
      const user = await signUpAndSignIn('cancel-no-token', ['client']);
      const created = await fastify().inject({
        method: 'POST',
        url: '/v1/me/data-requests',
        headers: { ...authHeaders(user.token), origin: 'http://localhost:3000' },
        payload: { type: 'delete' },
      });
      const dataRequestId = created.json<DataRequestBody>().id;

      const response = await fastify().inject({
        method: 'POST',
        url: `/v1/me/data-requests/${dataRequestId}/cancel`,
        headers: { origin: 'http://localhost:3000' },
      });
      expect(response.statusCode).toBe(401);
    });

    it('returns 401 for an invalid token', async () => {
      const user = await signUpAndSignIn('cancel-bad-token', ['client']);
      const created = await fastify().inject({
        method: 'POST',
        url: '/v1/me/data-requests',
        headers: { ...authHeaders(user.token), origin: 'http://localhost:3000' },
        payload: { type: 'delete' },
      });
      const dataRequestId = created.json<DataRequestBody>().id;

      const response = await fastify().inject({
        method: 'POST',
        url: `/v1/me/data-requests/${dataRequestId}/cancel`,
        headers: { origin: 'http://localhost:3000' },
        payload: { token: 'not-a-real-token' },
      });
      expect(response.statusCode).toBe(401);
    });

    it('returns 409 once the request is no longer pending', async () => {
      const user = await signUpAndSignIn('cancel-not-pending', ['client']);
      const created = await fastify().inject({
        method: 'POST',
        url: '/v1/me/data-requests',
        headers: { ...authHeaders(user.token), origin: 'http://localhost:3000' },
        payload: { type: 'delete' },
      });
      const dataRequestId = created.json<DataRequestBody>().id;
      await prisma.dataRequest.update({
        where: { id: dataRequestId },
        data: { status: 'completed' },
      });

      const link = await waitForLinkInEmail(
        user.email,
        /https?:\/\/\S*account\/deletion\/cancel\/\S+#token=\S+/,
      );
      const token = extractFragmentToken(link);

      const response = await fastify().inject({
        method: 'POST',
        url: `/v1/me/data-requests/${dataRequestId}/cancel`,
        headers: { origin: 'http://localhost:3000' },
        payload: { token },
      });
      expect(response.statusCode).toBe(409);
    });

    it('returns the "no longer pending" message, not the grace-period one, for an already-completed row past the grace period', async () => {
      const user = await signUpAndSignIn('cancel-completed-past-grace', ['client']);
      const created = await fastify().inject({
        method: 'POST',
        url: '/v1/me/data-requests',
        headers: { ...authHeaders(user.token), origin: 'http://localhost:3000' },
        payload: { type: 'delete' },
      });
      const dataRequestId = created.json<DataRequestBody>().id;
      await prisma.dataRequest.update({
        where: { id: dataRequestId },
        data: {
          status: 'completed',
          completedAt: new Date(),
          requestedAt: new Date(Date.now() - GDPR_DELETION_GRACE_PERIOD_MS - 1000),
        },
      });

      const link = await waitForLinkInEmail(
        user.email,
        /https?:\/\/\S*account\/deletion\/cancel\/\S+#token=\S+/,
      );
      const token = extractFragmentToken(link);

      const response = await fastify().inject({
        method: 'POST',
        url: `/v1/me/data-requests/${dataRequestId}/cancel`,
        headers: { origin: 'http://localhost:3000' },
        payload: { token },
      });
      expect(response.statusCode).toBe(409);
      const body = response.json<ApiErrorBody>();
      expect(body.message).toBe('Data request is no longer pending');
      expect(body.message).not.toMatch(/grace period/i);

      const unchanged = await prisma.dataRequest.findUniqueOrThrow({
        where: { id: dataRequestId },
      });
      expect(unchanged.status).toBe('completed');
    });

    it('returns 409 once the grace period has ended, and changes nothing', async () => {
      const user = await signUpAndSignIn('cancel-past-grace', ['client']);
      const created = await fastify().inject({
        method: 'POST',
        url: '/v1/me/data-requests',
        headers: { ...authHeaders(user.token), origin: 'http://localhost:3000' },
        payload: { type: 'delete' },
      });
      const dataRequestId = created.json<DataRequestBody>().id;
      await prisma.dataRequest.update({
        where: { id: dataRequestId },
        data: {
          requestedAt: new Date(Date.now() - GDPR_DELETION_GRACE_PERIOD_MS - 1000),
          failureReason: 'anonymisation_failed',
        },
      });

      const link = await waitForLinkInEmail(
        user.email,
        /https?:\/\/\S*account\/deletion\/cancel\/\S+#token=\S+/,
      );
      const token = extractFragmentToken(link);

      const response = await fastify().inject({
        method: 'POST',
        url: `/v1/me/data-requests/${dataRequestId}/cancel`,
        headers: { origin: 'http://localhost:3000' },
        payload: { token },
      });
      expect(response.statusCode).toBe(409);
      expect(response.json<ApiErrorBody>().message).toMatch(/grace period has ended/i);

      const unchanged = await prisma.dataRequest.findUniqueOrThrow({
        where: { id: dataRequestId },
      });
      expect(unchanged.status).toBe('pending');
      expect(unchanged.cancelledAt).toBeNull();

      const restored = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(restored.status).toBe('deleted');

      const auditRow = await prisma.auditLog.findFirst({
        where: {
          targetType: 'DataRequest',
          targetId: dataRequestId,
          action: 'data_request.cancelled',
        },
      });
      expect(auditRow).toBeNull();
    });

    it('still cancels a few minutes inside the grace period', async () => {
      const user = await signUpAndSignIn('cancel-within-grace', ['client']);
      const created = await fastify().inject({
        method: 'POST',
        url: '/v1/me/data-requests',
        headers: { ...authHeaders(user.token), origin: 'http://localhost:3000' },
        payload: { type: 'delete' },
      });
      const dataRequestId = created.json<DataRequestBody>().id;

      const link = await waitForLinkInEmail(
        user.email,
        /https?:\/\/\S*account\/deletion\/cancel\/\S+#token=\S+/,
      );
      const token = extractFragmentToken(link);

      await prisma.dataRequest.update({
        where: { id: dataRequestId },
        data: { requestedAt: new Date(Date.now() - GDPR_DELETION_GRACE_PERIOD_MS + 60_000) },
      });

      const response = await fastify().inject({
        method: 'POST',
        url: `/v1/me/data-requests/${dataRequestId}/cancel`,
        headers: { origin: 'http://localhost:3000' },
        payload: { token },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json<DataRequestBody>().status).toBe('cancelled');
    });
  });

  describe('GET /v1/me/data-requests/:id/download', () => {
    it('returns 409 while the export is not ready', async () => {
      const user = await signUpAndSignIn('download-not-ready', ['client']);
      const created = await fastify().inject({
        method: 'POST',
        url: '/v1/me/data-requests',
        headers: { ...authHeaders(user.token), origin: 'http://localhost:3000' },
        payload: { type: 'export' },
      });
      const id = created.json<DataRequestBody>().id;

      const response = await fastify().inject({
        method: 'GET',
        url: `/v1/me/data-requests/${id}/download`,
        headers: authHeaders(user.token),
      });
      expect(response.statusCode).toBe(409);
    });

    it('returns 403 for a data request that belongs to someone else', async () => {
      const owner = await signUpAndSignIn('download-owner', ['client']);
      const stranger = await signUpAndSignIn('download-stranger', ['client']);
      const created = await fastify().inject({
        method: 'POST',
        url: '/v1/me/data-requests',
        headers: { ...authHeaders(owner.token), origin: 'http://localhost:3000' },
        payload: { type: 'export' },
      });
      const id = created.json<DataRequestBody>().id;
      await prisma.dataRequest.update({
        where: { id },
        data: {
          status: 'ready',
          exportKey: 'exports/fixture.zip',
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        },
      });

      const response = await fastify().inject({
        method: 'GET',
        url: `/v1/me/data-requests/${id}/download`,
        headers: authHeaders(stranger.token),
      });
      expect(response.statusCode).toBe(403);
    });

    it('issues a presigned url while ready, and 410 once expired', async () => {
      const user = await signUpAndSignIn('download-ready', ['client']);
      const created = await fastify().inject({
        method: 'POST',
        url: '/v1/me/data-requests',
        headers: { ...authHeaders(user.token), origin: 'http://localhost:3000' },
        payload: { type: 'export' },
      });
      const id = created.json<DataRequestBody>().id;
      await prisma.dataRequest.update({
        where: { id },
        data: {
          status: 'ready',
          exportKey: 'exports/fixture.zip',
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        },
      });

      const ready = await fastify().inject({
        method: 'GET',
        url: `/v1/me/data-requests/${id}/download`,
        headers: authHeaders(user.token),
      });
      expect(ready.statusCode).toBe(200);
      const body = ready.json<{ url: string; expiresAt: string }>();
      expect(body.url).toContain('http');

      const auditRow = await prisma.auditLog.findFirst({
        where: { targetType: 'DataRequest', targetId: id, action: 'data_request.download_issued' },
      });
      expect(auditRow).not.toBeNull();
      expect(JSON.stringify(auditRow)).not.toContain(body.url);

      await prisma.dataRequest.update({
        where: { id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      const expired = await fastify().inject({
        method: 'GET',
        url: `/v1/me/data-requests/${id}/download`,
        headers: authHeaders(user.token),
      });
      expect(expired.statusCode).toBe(410);
    });
  });
});
