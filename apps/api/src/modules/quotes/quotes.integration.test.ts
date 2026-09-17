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

function extractFragmentToken(link: string): string | null {
  const hashIndex = link.indexOf('#token=');
  if (hashIndex === -1) {
    return null;
  }
  return decodeURIComponent(link.slice(hashIndex + '#token='.length));
}

function uniqueEmail(label: string): string {
  return `quotes-${label}-${randomUUID()}@photoo.test`;
}

interface QuoteBody {
  id: string;
  requestId: string | null;
  photographerId: string;
  clientId: string;
  productId: string | null;
  productTierId: string | null;
  subtotal: { amountCents: number; currency: string };
  platformFee: { amountCents: number; currency: string };
  total: { amountCents: number; currency: string };
  status: string;
}

interface RequestBody {
  id: string;
  currency: string;
}

interface ProductBody {
  id: string;
  tiers: { id: string; usage: string }[];
}

interface PaginatedBody<T> {
  items: T[];
  nextCursor: string | null;
}

// Derived from RUN_ID and always in the Pacific (lng in [-170, -140])
// regardless of seed, so this suite's fixtures can never land near
// Luxembourg's coordinates or any other suite's coordinates (issue #50).
const RUN_ID = randomUUID().replaceAll('-', '').slice(0, 8);
const RUN_SEED = Number.parseInt(RUN_ID, 16);
const RUN_LAT = -20 + (RUN_SEED % 400) / 10;
const RUN_LNG = -170 + (RUN_SEED % 300) / 10;

// Used as remoteAddress on every fastify().inject() call in this file (not
// just auth), so the per-IP request/quote-create rate limits stay isolated
// from requests.integration.test.ts on the same Redis (issue #50).
const AUTH_FAKE_IP = '10.50.6.1';

describe('quotes integration', () => {
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

  async function signUpAndSignIn(roles: readonly string[]): Promise<{ token: string; id: string }> {
    const email = uniqueEmail(roles.join('-'));
    const signUpResponse = await fastify().inject({
      method: 'POST',
      url: '/v1/auth/sign-up',
      remoteAddress: AUTH_FAKE_IP,
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

  function requestPayload(overrides: Record<string, unknown> = {}) {
    const eventDate = new Date();
    eventDate.setUTCDate(eventDate.getUTCDate() + 30);
    return {
      title: 'Looking for a wedding photographer',
      category: 'wedding',
      description: 'Full day coverage needed.',
      eventDate: eventDate.toISOString(),
      dateFlexible: false,
      location: { lat: RUN_LAT, lng: RUN_LNG },
      address: {
        line1: '1 Fixture Way',
        city: `Fx City ${RUN_ID}`,
        postalCode: 'L-1000',
        countryCode: 'LU',
      },
      budgetMin: { amountCents: 100000, currency: 'EUR' },
      budgetMax: { amountCents: 200000, currency: 'EUR' },
      usage: 'personal',
      ...overrides,
    };
  }

  async function createRequestAs(token: string, overrides: Record<string, unknown> = {}) {
    const response = await fastify().inject({
      method: 'POST',
      url: '/v1/requests',
      remoteAddress: AUTH_FAKE_IP,
      headers: authHeaders(token),
      payload: requestPayload(overrides),
    });
    return response.json<RequestBody>();
  }

  // Bypasses the request-creation endpoint (and its own 10/hour rate limit)
  // for tests that need many requests from a single client to exercise the
  // quote-creation rate limit in isolation.
  async function createRequestDirect(clientId: string, suffix: string): Promise<RequestBody> {
    const eventDate = new Date();
    eventDate.setUTCDate(eventDate.getUTCDate() + 30);
    const expiresAt = new Date();
    expiresAt.setUTCDate(expiresAt.getUTCDate() + 60);
    const created = await prisma.request.create({
      data: {
        clientId,
        title: `Direct fixture request ${suffix}`,
        category: 'wedding',
        description: 'Fixture request created directly for rate-limit testing.',
        eventDate,
        dateFlexible: false,
        address: {
          line1: '1 Fixture Way',
          city: `Fx City ${RUN_ID}`,
          postalCode: 'L-1000',
          countryCode: 'LU',
        },
        city: `Fx City ${RUN_ID}`,
        countryCode: 'LU',
        budgetMinCents: 100000,
        budgetMaxCents: 200000,
        currency: 'EUR',
        usage: 'personal',
        status: 'open',
        expiresAt,
      },
    });
    await prisma.$executeRaw`
      UPDATE "Request"
      SET location = ST_SetSRID(ST_MakePoint(${RUN_LNG}, ${RUN_LAT}), 4326)::geography
      WHERE id = ${created.id}
    `;
    return { id: created.id, currency: created.currency };
  }

  async function createPublishedPhotographer(
    suffix: string,
  ): Promise<{ token: string; userId: string; profileId: string; slug: string }> {
    const user = await signUpAndSignIn(['photographer']);
    const createResponse = await fastify().inject({
      method: 'POST',
      url: '/v1/me/photographer-profile',
      headers: authHeaders(user.token),
      payload: {
        displayName: `Fx Quote Photog ${suffix}`,
        categories: ['wedding'],
        languages: ['en'],
        location: { lat: RUN_LAT, lng: RUN_LNG },
        city: `Fx Quote City ${suffix}`,
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
    return { token: user.token, userId: user.id, profileId: profile.id, slug: profile.slug };
  }

  async function createProduct(photographerToken: string) {
    const response = await fastify().inject({
      method: 'POST',
      url: '/v1/me/products',
      headers: authHeaders(photographerToken),
      payload: {
        title: { en: 'Wedding package' },
        category: 'wedding',
        durationMinutes: 240,
        deliverables: { photos: 200, editedPhotos: 100, turnaroundDays: 14, onlineGallery: true },
        basePrice: { amountCents: 80000, currency: 'EUR' },
        tiers: [
          {
            usage: 'personal',
            price: { amountCents: 80000, currency: 'EUR' },
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

  async function sendQuote(
    photographerToken: string,
    requestId: string,
    lineItems: { label: string; qty: number; unitCents: number }[] = [
      { label: 'Coverage', qty: 1, unitCents: 50000 },
    ],
  ) {
    return fastify().inject({
      method: 'POST',
      url: '/v1/quotes',
      remoteAddress: AUTH_FAKE_IP,
      headers: authHeaders(photographerToken),
      payload: { requestId, lineItems, validUntil: futureIso(5) },
    });
  }

  async function requestDirectQuote(
    clientToken: string,
    slug: string,
    productId: string,
    body: Record<string, unknown>,
  ) {
    return fastify().inject({
      method: 'POST',
      url: `/v1/photographers/${slug}/products/${productId}/quotes`,
      remoteAddress: AUTH_FAKE_IP,
      headers: authHeaders(clientToken),
      payload: body,
    });
  }

  // Scoped to this file's own accounts and fake IP, never a bare
  // `rate-limit:requests:*` glob: that would also match
  // requests.integration.test.ts's accounts running in parallel against
  // the same Redis and reset its counters mid-test (issue #50).
  async function clearRateLimitKeys(): Promise<void> {
    const exact = [
      ...createdUserIds.flatMap((id) => [
        `rate-limit:requests:create:account:${id}`,
        `lockout:requests:create:account:${id}`,
        `rate-limit:quotes:create:account:${id}`,
        `lockout:quotes:create:account:${id}`,
        `rate-limit:quotes:direct-create:account:${id}`,
        `lockout:quotes:direct-create:account:${id}`,
      ]),
      `rate-limit:requests:create:ip:${AUTH_FAKE_IP}`,
      `lockout:requests:create:ip:${AUTH_FAKE_IP}`,
      `rate-limit:quotes:create:ip:${AUTH_FAKE_IP}`,
      `lockout:quotes:create:ip:${AUTH_FAKE_IP}`,
      `rate-limit:quotes:direct-create:ip:${AUTH_FAKE_IP}`,
      `lockout:quotes:direct-create:ip:${AUTH_FAKE_IP}`,
    ];
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
    if (createdUserIds.length > 0 || createdProfileIds.length > 0) {
      await prisma.quote.deleteMany({
        where: {
          OR: [{ clientId: { in: createdUserIds } }, { photographerId: { in: createdProfileIds } }],
        },
      });
      await prisma.request.deleteMany({ where: { clientId: { in: createdUserIds } } });
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    await prisma.$disconnect();
    redis.disconnect();
    await app.close();
  });

  describe('POST /v1/quotes (request quote)', () => {
    it('rejects a caller without the photographer role with 403', async () => {
      const client = await signUpAndSignIn(['client']);
      const request = await createRequestAs(client.token);
      const otherClient = await signUpAndSignIn(['client']);

      const response = await sendQuote(otherClient.token, request.id);
      expect(response.statusCode).toBe(403);
    });

    it('computes subtotal, platform fee and total from lineItems via the shared fee helper', async () => {
      const client = await signUpAndSignIn(['client']);
      const request = await createRequestAs(client.token);
      const photographer = await createPublishedPhotographer('totals');

      const response = await sendQuote(photographer.token, request.id, [
        { label: 'Half day', qty: 2, unitCents: 12525 },
      ]);
      expect(response.statusCode).toBe(201);
      const body = response.json<QuoteBody>();
      expect(body.subtotal).toEqual({ amountCents: 25050, currency: 'EUR' });
      expect(body.platformFee).toEqual({ amountCents: 1253, currency: 'EUR' });
      expect(body.total).toEqual({ amountCents: 25050, currency: 'EUR' });

      const createLog = await prisma.auditLog.findFirst({
        where: { targetType: 'Quote', targetId: body.id, action: 'quote.created' },
      });
      expect(createLog).not.toBeNull();
      expect((createLog?.after as { totalCents?: number } | null)?.totalCents).toBe(25050);
    });

    it('computes totals for several line-item sets, including half-cent rounding', async () => {
      const client = await signUpAndSignIn(['client']);
      const photographer = await createPublishedPhotographer('totals-multi');

      const threeItemsRequest = await createRequestAs(client.token);
      const threeItems = await sendQuote(photographer.token, threeItemsRequest.id, [
        { label: 'Session', qty: 1, unitCents: 10000 },
        { label: 'Album', qty: 2, unitCents: 5000 },
        { label: 'Print', qty: 3, unitCents: 999 },
      ]);
      expect(threeItems.statusCode).toBe(201);
      const threeItemsBody = threeItems.json<QuoteBody>();
      expect(threeItemsBody.subtotal.amountCents).toBe(22997);
      expect(threeItemsBody.platformFee.amountCents).toBe(1150);

      const halfCentRequest = await createRequestAs(client.token);
      const halfCent = await sendQuote(photographer.token, halfCentRequest.id, [
        { label: 'Odd cent', qty: 1, unitCents: 101 },
      ]);
      expect(halfCent.statusCode).toBe(201);
      const halfCentBody = halfCent.json<QuoteBody>();
      expect(halfCentBody.subtotal.amountCents).toBe(101);
      expect(halfCentBody.platformFee.amountCents).toBe(5);
    });

    it('rejects a validUntil after the request expiresAt with 422', async () => {
      const client = await signUpAndSignIn(['client']);
      const request = await createRequestAs(client.token);
      const photographer = await createPublishedPhotographer('valid-until');

      const farFuture = new Date();
      farFuture.setUTCDate(farFuture.getUTCDate() + 90);
      const response = await fastify().inject({
        method: 'POST',
        url: '/v1/quotes',
        remoteAddress: AUTH_FAKE_IP,
        headers: authHeaders(photographer.token),
        payload: {
          requestId: request.id,
          lineItems: [{ label: 'Coverage', qty: 1, unitCents: 50000 }],
          validUntil: farFuture.toISOString(),
        },
      });
      expect(response.statusCode).toBe(422);
    });

    it('rejects a zero total with 422', async () => {
      const client = await signUpAndSignIn(['client']);
      const request = await createRequestAs(client.token);
      const photographer = await createPublishedPhotographer('zero-total');

      const response = await sendQuote(photographer.token, request.id, [
        { label: 'Free', qty: 1, unitCents: 0 },
      ]);
      expect(response.statusCode).toBe(422);
    });

    it('rejects a total above the cap with 422', async () => {
      const client = await signUpAndSignIn(['client']);
      const request = await createRequestAs(client.token);
      const photographer = await createPublishedPhotographer('over-cap');

      const response = await sendQuote(photographer.token, request.id, [
        { label: 'A', qty: 1, unitCents: 99_999_999 },
        { label: 'B', qty: 1, unitCents: 99_999_999 },
      ]);
      expect(response.statusCode).toBe(422);
    });

    it('rejects a quote currency that does not match the request currency', async () => {
      const client = await signUpAndSignIn(['client']);
      const request = await createRequestAs(client.token);
      await prisma.request.update({ where: { id: request.id }, data: { currency: 'USD' } });
      const photographer = await createPublishedPhotographer('currency-mismatch');

      const response = await sendQuote(photographer.token, request.id);
      expect(response.statusCode).toBe(422);
    });

    it('rejects quoting your own request with 422', async () => {
      const both = await signUpAndSignIn(['client', 'photographer']);
      const createResponse = await fastify().inject({
        method: 'POST',
        url: '/v1/me/photographer-profile',
        headers: authHeaders(both.token),
        payload: {
          displayName: 'Fx Own Request Photographer',
          categories: ['wedding'],
          languages: ['en'],
          location: { lat: RUN_LAT, lng: RUN_LNG },
          city: 'Fx Own Request City',
          countryCode: 'LU',
        },
      });
      const profile = createResponse.json<{ id: string }>();
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

      const request = await createRequestAs(both.token);
      const response = await sendQuote(both.token, request.id);
      expect(response.statusCode).toBe(422);
    });

    it('rejects a photographer without a published profile with 403', async () => {
      const client = await signUpAndSignIn(['client']);
      const request = await createRequestAs(client.token);
      const photographer = await signUpAndSignIn(['photographer']);
      await fastify().inject({
        method: 'POST',
        url: '/v1/me/photographer-profile',
        headers: authHeaders(photographer.token),
        payload: {
          displayName: 'Fx Unpublished',
          categories: ['wedding'],
          languages: ['en'],
          location: { lat: RUN_LAT, lng: RUN_LNG },
          city: 'Fx Unpublished City',
          countryCode: 'LU',
        },
      });

      const response = await sendQuote(photographer.token, request.id);
      expect(response.statusCode).toBe(403);
    });

    it('rejects a second sent quote with 409, and allows one again after withdraw', async () => {
      const client = await signUpAndSignIn(['client']);
      const request = await createRequestAs(client.token);
      const photographer = await createPublishedPhotographer('duplicate');

      const first = await sendQuote(photographer.token, request.id);
      expect(first.statusCode).toBe(201);

      const second = await sendQuote(photographer.token, request.id);
      expect(second.statusCode).toBe(409);

      const firstQuote = first.json<QuoteBody>();
      const withdraw = await fastify().inject({
        method: 'POST',
        url: `/v1/quotes/${firstQuote.id}/withdraw`,
        headers: authHeaders(photographer.token),
      });
      expect(withdraw.statusCode).toBe(200);

      const third = await sendQuote(photographer.token, request.id);
      expect(third.statusCode).toBe(201);
    });

    it('rate limits quote creation to 30 per hour', async () => {
      const client = await signUpAndSignIn(['client']);
      const photographer = await createPublishedPhotographer('rate-limit');

      for (let i = 0; i < 30; i += 1) {
        const request = await createRequestDirect(client.id, `rl-${String(i)}`);
        const response = await sendQuote(photographer.token, request.id);
        expect(response.statusCode).toBe(201);
      }

      const request = await createRequestDirect(client.id, 'rl-overflow');
      const overflow = await sendQuote(photographer.token, request.id);
      expect(overflow.statusCode).toBe(429);
    });
  });

  describe('POST /v1/photographers/:slug/products/:productId/quotes (direct quote)', () => {
    it('builds the line item from the tier server-side and rejects client-supplied price fields with 400', async () => {
      const photographer = await createPublishedPhotographer('direct');
      const product = await createProduct(photographer.token);
      const tier = product.tiers[0];
      if (!tier) {
        throw new Error('expected a tier');
      }
      const client = await signUpAndSignIn(['client']);

      const tampered = await requestDirectQuote(client.token, photographer.slug, product.id, {
        productTierId: tier.id,
        unitCents: 1,
      });
      expect(tampered.statusCode).toBe(400);

      const response = await requestDirectQuote(client.token, photographer.slug, product.id, {
        productTierId: tier.id,
      });
      expect(response.statusCode).toBe(201);
      const body = response.json<QuoteBody>();
      expect(body.total).toEqual({ amountCents: 80000, currency: 'EUR' });
      expect(body.requestId).toBeNull();
      expect(body.productTierId).toBe(tier.id);
    });

    it('rejects requesting a quote from your own profile with 422', async () => {
      const photographer = await createPublishedPhotographer('own-product');
      const product = await createProduct(photographer.token);
      const tier = product.tiers[0];
      if (!tier) {
        throw new Error('expected a tier');
      }

      const response = await requestDirectQuote(photographer.token, photographer.slug, product.id, {
        productTierId: tier.id,
      });
      expect(response.statusCode).toBe(422);
    });

    it('returns 404 for a product on an unpublished profile', async () => {
      const photographer = await signUpAndSignIn(['photographer']);
      const createResponse = await fastify().inject({
        method: 'POST',
        url: '/v1/me/photographer-profile',
        headers: authHeaders(photographer.token),
        payload: {
          displayName: 'Fx Direct Unpublished',
          categories: ['wedding'],
          languages: ['en'],
          location: { lat: RUN_LAT, lng: RUN_LNG },
          city: 'Fx Direct Unpublished City',
          countryCode: 'LU',
        },
      });
      const profile = createResponse.json<{ id: string; slug: string }>();
      createdProfileIds.push(profile.id);
      const product = await createProduct(photographer.token);
      const tier = product.tiers[0];
      if (!tier) {
        throw new Error('expected a tier');
      }
      const client = await signUpAndSignIn(['client']);

      const response = await requestDirectQuote(client.token, profile.slug, product.id, {
        productTierId: tier.id,
      });
      expect(response.statusCode).toBe(404);
    });

    it('returns 404 for an inactive product', async () => {
      const photographer = await createPublishedPhotographer('direct-inactive');
      const product = await createProduct(photographer.token);
      const tier = product.tiers[0];
      if (!tier) {
        throw new Error('expected a tier');
      }
      await prisma.product.update({ where: { id: product.id }, data: { isActive: false } });
      const client = await signUpAndSignIn(['client']);

      const response = await requestDirectQuote(client.token, photographer.slug, product.id, {
        productTierId: tier.id,
      });
      expect(response.statusCode).toBe(404);
    });

    it('rate limits direct quote creation to 10 per hour', async () => {
      const photographer = await createPublishedPhotographer('direct-rate-limit');
      const product = await createProduct(photographer.token);
      const tier = product.tiers[0];
      if (!tier) {
        throw new Error('expected a tier');
      }
      const client = await signUpAndSignIn(['client']);

      for (let i = 0; i < 10; i += 1) {
        const response = await requestDirectQuote(client.token, photographer.slug, product.id, {
          productTierId: tier.id,
        });
        expect(response.statusCode).toBe(201);
      }

      const overflow = await requestDirectQuote(client.token, photographer.slug, product.id, {
        productTierId: tier.id,
      });
      expect(overflow.statusCode).toBe(429);
    });
  });

  describe('quote lifecycle', () => {
    it('accepts a quote, declines siblings, books the request, and writes audit logs', async () => {
      const client = await signUpAndSignIn(['client']);
      const request = await createRequestAs(client.token);
      const winner = await createPublishedPhotographer('winner');
      const loser = await createPublishedPhotographer('loser');

      const winnerQuote = (await sendQuote(winner.token, request.id)).json<QuoteBody>();
      const loserQuote = (await sendQuote(loser.token, request.id)).json<QuoteBody>();

      const accept = await fastify().inject({
        method: 'POST',
        url: `/v1/quotes/${winnerQuote.id}/accept`,
        headers: authHeaders(client.token),
      });
      expect(accept.statusCode).toBe(200);
      expect(accept.json<QuoteBody>().status).toBe('accepted');

      const loserAfter = await prisma.quote.findUniqueOrThrow({ where: { id: loserQuote.id } });
      expect(loserAfter.status).toBe('declined');

      const requestAfter = await prisma.request.findUniqueOrThrow({ where: { id: request.id } });
      expect(requestAfter.status).toBe('booked');

      const acceptLog = await prisma.auditLog.findFirst({
        where: { targetType: 'Quote', targetId: winnerQuote.id, action: 'quote.accepted' },
      });
      expect(acceptLog).not.toBeNull();
      expect(
        (acceptLog?.after as { declinedQuoteIds?: string[] } | null)?.declinedQuoteIds,
      ).toEqual([loserQuote.id]);

      const createLog = await prisma.auditLog.findFirst({
        where: { targetType: 'Quote', targetId: winnerQuote.id, action: 'quote.created' },
      });
      expect(createLog).not.toBeNull();
    });

    it('leaves exactly one winner when two quotes on the same request are accepted concurrently', async () => {
      const client = await signUpAndSignIn(['client']);
      const request = await createRequestAs(client.token);
      const photographerA = await createPublishedPhotographer('race-a');
      const photographerB = await createPublishedPhotographer('race-b');

      const quoteA = (await sendQuote(photographerA.token, request.id)).json<QuoteBody>();
      const quoteB = (await sendQuote(photographerB.token, request.id)).json<QuoteBody>();

      const [responseA, responseB] = await Promise.all([
        fastify().inject({
          method: 'POST',
          url: `/v1/quotes/${quoteA.id}/accept`,
          headers: authHeaders(client.token),
        }),
        fastify().inject({
          method: 'POST',
          url: `/v1/quotes/${quoteB.id}/accept`,
          headers: authHeaders(client.token),
        }),
      ]);

      const statuses = [responseA.statusCode, responseB.statusCode].sort();
      expect(statuses).toEqual([200, 409]);

      const finalA = await prisma.quote.findUniqueOrThrow({ where: { id: quoteA.id } });
      const finalB = await prisma.quote.findUniqueOrThrow({ where: { id: quoteB.id } });
      const acceptedCount = [finalA.status, finalB.status].filter(
        (status) => status === 'accepted',
      ).length;
      expect(acceptedCount).toBe(1);

      const requestAfter = await prisma.request.findUniqueOrThrow({ where: { id: request.id } });
      expect(requestAfter.status).toBe('booked');
    });

    it('rejects accepting an expired quote with 409 and marks it expired', async () => {
      const client = await signUpAndSignIn(['client']);
      const request = await createRequestAs(client.token);
      const photographer = await createPublishedPhotographer('expired-accept');
      const quote = (await sendQuote(photographer.token, request.id)).json<QuoteBody>();

      await prisma.quote.update({
        where: { id: quote.id },
        data: { validUntil: new Date(Date.now() - 1000) },
      });

      const response = await fastify().inject({
        method: 'POST',
        url: `/v1/quotes/${quote.id}/accept`,
        headers: authHeaders(client.token),
      });
      expect(response.statusCode).toBe(409);

      const after = await prisma.quote.findUniqueOrThrow({ where: { id: quote.id } });
      expect(after.status).toBe('expired');
    });

    it('rejects a non-client from accepting with 404', async () => {
      const client = await signUpAndSignIn(['client']);
      const request = await createRequestAs(client.token);
      const photographer = await createPublishedPhotographer('accept-forbidden');
      const quote = (await sendQuote(photographer.token, request.id)).json<QuoteBody>();

      const response = await fastify().inject({
        method: 'POST',
        url: `/v1/quotes/${quote.id}/accept`,
        headers: authHeaders(photographer.token),
      });
      expect(response.statusCode).toBe(404);
    });

    it('rejects the client withdrawing a quote with 404', async () => {
      const client = await signUpAndSignIn(['client']);
      const request = await createRequestAs(client.token);
      const photographer = await createPublishedPhotographer('withdraw-forbidden');
      const quote = (await sendQuote(photographer.token, request.id)).json<QuoteBody>();

      const response = await fastify().inject({
        method: 'POST',
        url: `/v1/quotes/${quote.id}/withdraw`,
        headers: authHeaders(client.token),
      });
      expect(response.statusCode).toBe(404);
    });

    it('rejects declining or withdrawing an already-accepted quote with 409', async () => {
      const client = await signUpAndSignIn(['client']);
      const request = await createRequestAs(client.token);
      const photographer = await createPublishedPhotographer('accepted-terminal');
      const quote = (await sendQuote(photographer.token, request.id)).json<QuoteBody>();

      const accept = await fastify().inject({
        method: 'POST',
        url: `/v1/quotes/${quote.id}/accept`,
        headers: authHeaders(client.token),
      });
      expect(accept.statusCode).toBe(200);

      const decline = await fastify().inject({
        method: 'POST',
        url: `/v1/quotes/${quote.id}/decline`,
        headers: authHeaders(client.token),
      });
      expect(decline.statusCode).toBe(409);

      const withdraw = await fastify().inject({
        method: 'POST',
        url: `/v1/quotes/${quote.id}/withdraw`,
        headers: authHeaders(photographer.token),
      });
      expect(withdraw.statusCode).toBe(409);
    });

    it('rejects accepting a direct quote whose profile was unpublished after it was sent', async () => {
      const photographer = await createPublishedPhotographer('accept-unpublished');
      const product = await createProduct(photographer.token);
      const tier = product.tiers[0];
      if (!tier) {
        throw new Error('expected a tier');
      }
      const client = await signUpAndSignIn(['client']);
      const quote = (
        await requestDirectQuote(client.token, photographer.slug, product.id, {
          productTierId: tier.id,
        })
      ).json<QuoteBody>();

      await prisma.photographerProfile.update({
        where: { id: photographer.profileId },
        data: { isPublished: false },
      });

      const response = await fastify().inject({
        method: 'POST',
        url: `/v1/quotes/${quote.id}/accept`,
        headers: authHeaders(client.token),
      });
      expect(response.statusCode).toBe(409);

      const after = await prisma.quote.findUniqueOrThrow({ where: { id: quote.id } });
      expect(after.status).toBe('expired');
    });

    it('rejects accepting a direct quote whose product was deactivated after it was sent', async () => {
      const photographer = await createPublishedPhotographer('accept-inactive');
      const product = await createProduct(photographer.token);
      const tier = product.tiers[0];
      if (!tier) {
        throw new Error('expected a tier');
      }
      const client = await signUpAndSignIn(['client']);
      const quote = (
        await requestDirectQuote(client.token, photographer.slug, product.id, {
          productTierId: tier.id,
        })
      ).json<QuoteBody>();

      await prisma.product.update({ where: { id: product.id }, data: { isActive: false } });

      const response = await fastify().inject({
        method: 'POST',
        url: `/v1/quotes/${quote.id}/accept`,
        headers: authHeaders(client.token),
      });
      expect(response.statusCode).toBe(409);

      const after = await prisma.quote.findUniqueOrThrow({ where: { id: quote.id } });
      expect(after.status).toBe('expired');
    });

    it('declines a quote and rejects declining it again with 409', async () => {
      const client = await signUpAndSignIn(['client']);
      const request = await createRequestAs(client.token);
      const photographer = await createPublishedPhotographer('decline');
      const quote = (await sendQuote(photographer.token, request.id)).json<QuoteBody>();

      const response = await fastify().inject({
        method: 'POST',
        url: `/v1/quotes/${quote.id}/decline`,
        headers: authHeaders(client.token),
      });
      expect(response.statusCode).toBe(200);
      expect(response.json<QuoteBody>().status).toBe('declined');

      const declineLog = await prisma.auditLog.findFirst({
        where: { targetType: 'Quote', targetId: quote.id, action: 'quote.declined' },
      });
      expect(declineLog).not.toBeNull();

      const again = await fastify().inject({
        method: 'POST',
        url: `/v1/quotes/${quote.id}/decline`,
        headers: authHeaders(client.token),
      });
      expect(again.statusCode).toBe(409);
    });

    it('withdraws a quote and rejects withdrawing it again with 409', async () => {
      const client = await signUpAndSignIn(['client']);
      const request = await createRequestAs(client.token);
      const photographer = await createPublishedPhotographer('withdraw');
      const quote = (await sendQuote(photographer.token, request.id)).json<QuoteBody>();

      const response = await fastify().inject({
        method: 'POST',
        url: `/v1/quotes/${quote.id}/withdraw`,
        headers: authHeaders(photographer.token),
      });
      expect(response.statusCode).toBe(200);
      expect(response.json<QuoteBody>().status).toBe('withdrawn');

      const withdrawLog = await prisma.auditLog.findFirst({
        where: { targetType: 'Quote', targetId: quote.id, action: 'quote.withdrawn' },
      });
      expect(withdrawLog).not.toBeNull();

      const again = await fastify().inject({
        method: 'POST',
        url: `/v1/quotes/${quote.id}/withdraw`,
        headers: authHeaders(photographer.token),
      });
      expect(again.statusCode).toBe(409);
    });
  });

  describe('reads', () => {
    it('returns 404 for a third party reading a quote', async () => {
      const client = await signUpAndSignIn(['client']);
      const request = await createRequestAs(client.token);
      const photographer = await createPublishedPhotographer('read-forbidden');
      const quote = (await sendQuote(photographer.token, request.id)).json<QuoteBody>();
      const thirdParty = await signUpAndSignIn(['client']);

      const response = await fastify().inject({
        method: 'GET',
        url: `/v1/quotes/${quote.id}`,
        headers: authHeaders(thirdParty.token),
      });
      expect(response.statusCode).toBe(404);
    });

    it('lets the owning client list quotes for a request, and returns 404 to a non-owner', async () => {
      const client = await signUpAndSignIn(['client']);
      const request = await createRequestAs(client.token);
      const photographer = await createPublishedPhotographer('list-for-request');
      await sendQuote(photographer.token, request.id);

      const own = await fastify().inject({
        method: 'GET',
        url: `/v1/requests/${request.id}/quotes`,
        headers: authHeaders(client.token),
      });
      expect(own.statusCode).toBe(200);
      expect(own.json<PaginatedBody<QuoteBody>>().items).toHaveLength(1);

      const other = await signUpAndSignIn(['client']);
      const response = await fastify().inject({
        method: 'GET',
        url: `/v1/requests/${request.id}/quotes`,
        headers: authHeaders(other.token),
      });
      expect(response.statusCode).toBe(404);
    });

    it('lists quotes/mine by role', async () => {
      const client = await signUpAndSignIn(['client']);
      const request = await createRequestAs(client.token);
      const photographer = await createPublishedPhotographer('mine');
      await sendQuote(photographer.token, request.id);

      const asClient = await fastify().inject({
        method: 'GET',
        url: '/v1/quotes/mine?role=client',
        headers: authHeaders(client.token),
      });
      expect(asClient.json<PaginatedBody<QuoteBody>>().items.length).toBeGreaterThan(0);

      const asPhotographer = await fastify().inject({
        method: 'GET',
        url: '/v1/quotes/mine?role=photographer',
        headers: authHeaders(photographer.token),
      });
      expect(asPhotographer.json<PaginatedBody<QuoteBody>>().items.length).toBeGreaterThan(0);
    });
  });
});
