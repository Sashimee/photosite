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

function isSnappedToGrid(value: number): boolean {
  return Math.abs(value * 100 - Math.round(value * 100)) < 1e-6;
}

function uniqueEmail(label: string): string {
  return `requests-${label}-${randomUUID()}@photoo.test`;
}

interface RequestBody {
  id: string;
  clientId?: string;
  status: string;
  location: { lat: number; lng: number };
  address?: unknown;
  hasQuoted?: boolean;
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
// from quotes.integration.test.ts on the same Redis (issue #50).
const AUTH_FAKE_IP = '10.50.5.1';

describe('requests integration', () => {
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
    return response;
  }

  async function createPublishedPhotographer(
    suffix: string,
    categories: readonly string[],
    lat: number,
    lng: number,
  ): Promise<{ token: string; userId: string; profileId: string; slug: string }> {
    const user = await signUpAndSignIn(['photographer']);
    const createResponse = await fastify().inject({
      method: 'POST',
      url: '/v1/me/photographer-profile',
      headers: authHeaders(user.token),
      payload: {
        displayName: `Fx Photog ${suffix}`,
        categories,
        languages: ['en'],
        location: { lat, lng },
        city: `Fx Photog City ${suffix}`,
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

  // Scoped to this file's own accounts and fake IP, never a bare
  // `rate-limit:requests:*` glob: that would also match
  // quotes.integration.test.ts's accounts running in parallel against the
  // same Redis and reset its counters mid-test (issue #50).
  async function clearRateLimitKeys(): Promise<void> {
    const exact = [
      ...createdUserIds.flatMap((id) => [
        `rate-limit:requests:create:account:${id}`,
        `lockout:requests:create:account:${id}`,
        `rate-limit:quotes:create:account:${id}`,
        `lockout:quotes:create:account:${id}`,
      ]),
      `rate-limit:requests:create:ip:${AUTH_FAKE_IP}`,
      `lockout:requests:create:ip:${AUTH_FAKE_IP}`,
      `rate-limit:quotes:create:ip:${AUTH_FAKE_IP}`,
      `lockout:quotes:create:ip:${AUTH_FAKE_IP}`,
    ];
    const patterns = [`rate-limit:auth:*:${AUTH_FAKE_IP}`, `lockout:auth:*:${AUTH_FAKE_IP}`];
    const globbed = (await Promise.all(patterns.map((pattern) => redis.keys(pattern)))).flat();
    const all = [...exact, ...globbed];
    if (all.length > 0) {
      await redis.del(...all);
    }
  }

  async function sendQuote(photographerToken: string, requestId: string) {
    const validUntil = new Date();
    validUntil.setUTCDate(validUntil.getUTCDate() + 5);
    return fastify().inject({
      method: 'POST',
      url: '/v1/quotes',
      remoteAddress: AUTH_FAKE_IP,
      headers: authHeaders(photographerToken),
      payload: {
        requestId,
        lineItems: [{ label: 'Coverage', qty: 1, unitCents: 50000 }],
        validUntil: validUntil.toISOString(),
      },
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
  });

  afterEach(async () => {
    await clearRateLimitKeys();
  });

  afterAll(async () => {
    if (createdUserIds.length > 0 || createdProfileIds.length > 0) {
      // Quote creation also creates a quote Conversation (docs/steps/1A.6-chat.md);
      // its ConversationParticipant rows must go before the users, since
      // that FK is Restrict.
      await prisma.conversation.deleteMany({
        where: { type: 'quote', participants: { some: { userId: { in: createdUserIds } } } },
      });
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

  describe('POST /v1/requests', () => {
    it('rejects an unauthenticated request with 401', async () => {
      const response = await fastify().inject({
        method: 'POST',
        url: '/v1/requests',
        payload: requestPayload(),
      });
      expect(response.statusCode).toBe(401);
    });

    it('rejects a disabled or unknown countryCode with 422', async () => {
      const client = await signUpAndSignIn(['client']);
      const response = await createRequestAs(client.token, {
        address: {
          line1: '1 Fixture Way',
          city: 'Nowhere',
          postalCode: '00000',
          countryCode: 'ZZ',
        },
      });
      expect(response.statusCode).toBe(422);
    });

    it("rejects a budget currency that does not match the address country's currency", async () => {
      const client = await signUpAndSignIn(['client']);
      const response = await createRequestAs(client.token, {
        budgetMin: { amountCents: 100000, currency: 'USD' },
        budgetMax: { amountCents: 200000, currency: 'USD' },
      });
      expect(response.statusCode).toBe(422);
    });

    it('creates a request with the full owner record, including address and exact location', async () => {
      const client = await signUpAndSignIn(['client']);
      const response = await createRequestAs(client.token);
      expect(response.statusCode).toBe(201);
      const body = response.json<RequestBody>();
      expect(body.clientId).toBe(client.id);
      expect(body.status).toBe('open');
      expect(body.address).toBeDefined();
      expect(body.location.lat).toBeCloseTo(RUN_LAT, 2);
      expect(body.location.lng).toBeCloseTo(RUN_LNG, 2);
    });

    it('rejects an eventDate in the past with 400', async () => {
      const client = await signUpAndSignIn(['client']);
      const pastEventDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const response = await createRequestAs(client.token, { eventDate: pastEventDate });
      expect(response.statusCode).toBe(400);
    });

    it('rate limits request creation to 10 per hour, returning 429 on the 11th', async () => {
      const client = await signUpAndSignIn(['client']);
      let last;
      for (let i = 0; i < 10; i += 1) {
        last = await createRequestAs(client.token);
        expect(last.statusCode).toBe(201);
      }
      const eleventh = await createRequestAs(client.token);
      expect(eleventh.statusCode).toBe(429);
    });
  });

  describe('GET /v1/requests/mine', () => {
    it('paginates the owner requests stably', async () => {
      const client = await signUpAndSignIn(['client']);
      await createRequestAs(client.token, { title: 'Mine A' });
      await createRequestAs(client.token, { title: 'Mine B' });

      const first = await fastify().inject({
        method: 'GET',
        url: '/v1/requests/mine?limit=1',
        headers: authHeaders(client.token),
      });
      const firstBody = first.json<PaginatedBody<RequestBody>>();
      expect(firstBody.items).toHaveLength(1);
      expect(firstBody.nextCursor).not.toBeNull();

      const second = await fastify().inject({
        method: 'GET',
        url: `/v1/requests/mine?limit=1&cursor=${String(firstBody.nextCursor)}`,
        headers: authHeaders(client.token),
      });
      const secondBody = second.json<PaginatedBody<RequestBody>>();
      expect(secondBody.items).toHaveLength(1);
      expect(secondBody.items[0]?.id).not.toBe(firstBody.items[0]?.id);
    });
  });

  describe('GET /v1/requests/:id privacy', () => {
    it('returns the full record to the owner', async () => {
      const client = await signUpAndSignIn(['client']);
      const created = (await createRequestAs(client.token)).json<RequestBody>();

      const response = await fastify().inject({
        method: 'GET',
        url: `/v1/requests/${created.id}`,
        headers: authHeaders(client.token),
      });
      expect(response.statusCode).toBe(200);
      expect(response.json<RequestBody>().address).toBeDefined();
    });

    it('returns 404 for an unrelated user with no quote on the request', async () => {
      const client = await signUpAndSignIn(['client']);
      const created = (await createRequestAs(client.token)).json<RequestBody>();
      const other = await signUpAndSignIn(['client']);

      const response = await fastify().inject({
        method: 'GET',
        url: `/v1/requests/${created.id}`,
        headers: authHeaders(other.token),
      });
      expect(response.statusCode).toBe(404);
    });

    it('returns the coarse summary (no address) to a photographer who sent a quote, and 404 before quoting', async () => {
      const client = await signUpAndSignIn(['client']);
      const created = (await createRequestAs(client.token)).json<RequestBody>();
      const photographer = await createPublishedPhotographer(
        'privacy',
        ['wedding'],
        RUN_LAT,
        RUN_LNG,
      );

      const before = await fastify().inject({
        method: 'GET',
        url: `/v1/requests/${created.id}`,
        headers: authHeaders(photographer.token),
      });
      expect(before.statusCode).toBe(404);

      const quoteResponse = await sendQuote(photographer.token, created.id);
      expect(quoteResponse.statusCode).toBe(201);

      const after = await fastify().inject({
        method: 'GET',
        url: `/v1/requests/${created.id}`,
        headers: authHeaders(photographer.token),
      });
      expect(after.statusCode).toBe(200);
      const summary = after.json<RequestBody>();
      expect(summary.address).toBeUndefined();
      expect(summary.hasQuoted).toBe(true);
      expect(isSnappedToGrid(summary.location.lat)).toBe(true);
      expect(isSnappedToGrid(summary.location.lng)).toBe(true);
    });
  });

  describe('POST /v1/requests/:id/cancel', () => {
    it('cancels an open request and declines its sent quotes', async () => {
      const client = await signUpAndSignIn(['client']);
      const created = (await createRequestAs(client.token)).json<RequestBody>();
      const photographer = await createPublishedPhotographer(
        'cancel',
        ['wedding'],
        RUN_LAT,
        RUN_LNG,
      );
      const quote = (await sendQuote(photographer.token, created.id)).json<{ id: string }>();

      const response = await fastify().inject({
        method: 'POST',
        url: `/v1/requests/${created.id}/cancel`,
        headers: authHeaders(client.token),
      });
      expect(response.statusCode).toBe(200);
      expect(response.json<RequestBody>().status).toBe('cancelled');

      const declinedQuote = await prisma.quote.findUniqueOrThrow({ where: { id: quote.id } });
      expect(declinedQuote.status).toBe('declined');

      const cancelLog = await prisma.auditLog.findFirst({
        where: { targetType: 'Request', targetId: created.id, action: 'request.cancelled' },
      });
      expect(cancelLog).not.toBeNull();
      expect(
        (cancelLog?.after as { declinedQuoteIds?: string[] } | null)?.declinedQuoteIds,
      ).toEqual([quote.id]);

      const again = await fastify().inject({
        method: 'POST',
        url: `/v1/requests/${created.id}/cancel`,
        headers: authHeaders(client.token),
      });
      expect(again.statusCode).toBe(409);
    });

    it('returns 404 when a non-owner tries to cancel', async () => {
      const client = await signUpAndSignIn(['client']);
      const created = (await createRequestAs(client.token)).json<RequestBody>();
      const other = await signUpAndSignIn(['client']);

      const response = await fastify().inject({
        method: 'POST',
        url: `/v1/requests/${created.id}/cancel`,
        headers: authHeaders(other.token),
      });
      expect(response.statusCode).toBe(404);
    });

    it('rejects cancelling an already-booked request with 409', async () => {
      const client = await signUpAndSignIn(['client']);
      const created = (await createRequestAs(client.token)).json<RequestBody>();
      const photographer = await createPublishedPhotographer(
        'cancel-booked',
        ['wedding'],
        RUN_LAT,
        RUN_LNG,
      );
      const quote = (await sendQuote(photographer.token, created.id)).json<{ id: string }>();
      const accept = await fastify().inject({
        method: 'POST',
        url: `/v1/quotes/${quote.id}/accept`,
        remoteAddress: AUTH_FAKE_IP,
        headers: authHeaders(client.token),
      });
      expect(accept.statusCode).toBe(200);

      const response = await fastify().inject({
        method: 'POST',
        url: `/v1/requests/${created.id}/cancel`,
        headers: authHeaders(client.token),
      });
      expect(response.statusCode).toBe(409);
    });
  });

  describe('GET /v1/requests (feed)', () => {
    it('rejects a caller without the photographer role with 403', async () => {
      const client = await signUpAndSignIn(['client']);
      const response = await fastify().inject({
        method: 'GET',
        url: '/v1/requests',
        headers: authHeaders(client.token),
      });
      expect(response.statusCode).toBe(403);
    });

    it('rejects a photographer without a profile with 403', async () => {
      const photographer = await signUpAndSignIn(['photographer']);
      const response = await fastify().inject({
        method: 'GET',
        url: '/v1/requests',
        headers: authHeaders(photographer.token),
      });
      expect(response.statusCode).toBe(403);
    });

    it('rejects a photographer with an unpublished profile with 403', async () => {
      const photographer = await signUpAndSignIn(['photographer']);
      await fastify().inject({
        method: 'POST',
        url: '/v1/me/photographer-profile',
        headers: authHeaders(photographer.token),
        payload: {
          displayName: 'Fx Unpublished Feed Photographer',
          categories: ['wedding'],
          languages: ['en'],
          location: { lat: RUN_LAT, lng: RUN_LNG },
          city: 'Fx Unpublished Feed City',
          countryCode: 'LU',
        },
      });

      const response = await fastify().inject({
        method: 'GET',
        url: '/v1/requests',
        headers: authHeaders(photographer.token),
      });
      expect(response.statusCode).toBe(403);
    });

    it('matches by category and radius, marks hasQuoted, and never exposes address or exact coordinates', async () => {
      const client = await signUpAndSignIn(['client']);
      const matching = (
        await createRequestAs(client.token, { title: 'Feed match' })
      ).json<RequestBody>();
      const wrongCategory = (
        await createRequestAs(client.token, { title: 'Feed wrong category', category: 'portrait' })
      ).json<RequestBody>();
      const farAway = (
        await createRequestAs(client.token, {
          title: 'Feed far away',
          location: { lat: RUN_LAT + 10, lng: RUN_LNG },
        })
      ).json<RequestBody>();

      const photographer = await createPublishedPhotographer('feed', ['wedding'], RUN_LAT, RUN_LNG);
      await sendQuote(photographer.token, matching.id);

      const response = await fastify().inject({
        method: 'GET',
        url: '/v1/requests?radiusKm=50',
        headers: authHeaders(photographer.token),
      });
      expect(response.statusCode).toBe(200);
      const body = response.json<PaginatedBody<RequestBody & { id: string }>>();
      const ids = body.items.map((item) => item.id);
      expect(ids).toContain(matching.id);
      expect(ids).not.toContain(wrongCategory.id);
      expect(ids).not.toContain(farAway.id);

      for (const item of body.items) {
        expect((item as { address?: unknown }).address).toBeUndefined();
        expect(isSnappedToGrid(item.location.lat)).toBe(true);
        expect(isSnappedToGrid(item.location.lng)).toBe(true);
      }
      const matchedItem = body.items.find((item) => item.id === matching.id);
      expect(matchedItem?.hasQuoted).toBe(true);
    });

    it('treats a malformed cursor as 400, not 500 (SQL injection attempt included)', async () => {
      const photographer = await createPublishedPhotographer(
        'cursor-injection',
        ['wedding'],
        RUN_LAT,
        RUN_LNG,
      );
      const response = await fastify().inject({
        method: 'GET',
        url: `/v1/requests?cursor=${encodeURIComponent('\'; DROP TABLE "Request"; --')}`,
        headers: authHeaders(photographer.token),
      });
      expect(response.statusCode).toBe(400);

      const stillThere = await fastify().inject({
        method: 'GET',
        url: '/v1/requests/mine',
        headers: authHeaders(photographer.token),
      });
      expect(stillThere.statusCode).toBe(200);
    });

    it('paginates stably across two pages', async () => {
      const client = await signUpAndSignIn(['client']);
      await createRequestAs(client.token, { title: 'Feed page A' });
      await createRequestAs(client.token, { title: 'Feed page B' });
      const photographer = await createPublishedPhotographer(
        'feed-paging',
        ['wedding'],
        RUN_LAT,
        RUN_LNG,
      );

      const first = await fastify().inject({
        method: 'GET',
        url: '/v1/requests?radiusKm=50&limit=1',
        headers: authHeaders(photographer.token),
      });
      const firstBody = first.json<PaginatedBody<{ id: string }>>();
      expect(firstBody.items).toHaveLength(1);
      expect(firstBody.nextCursor).not.toBeNull();

      const second = await fastify().inject({
        method: 'GET',
        url: `/v1/requests?radiusKm=50&limit=1&cursor=${String(firstBody.nextCursor)}`,
        headers: authHeaders(photographer.token),
      });
      const secondBody = second.json<PaginatedBody<{ id: string }>>();
      expect(secondBody.items).toHaveLength(1);
      expect(secondBody.items[0]?.id).not.toBe(firstBody.items[0]?.id);
    });
  });
});
