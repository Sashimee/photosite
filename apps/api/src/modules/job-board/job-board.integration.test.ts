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
const FAKE_IP = '10.50.21.1';
const RUN_ID = randomUUID().replaceAll('-', '').slice(0, 8);
const RUN_LAT = 40 + (Number.parseInt(RUN_ID, 16) % 200) / 10;
const RUN_LNG = 40 + (Number.parseInt(RUN_ID, 16) % 150) / 10;

function extractFragmentToken(link: string): string | null {
  const hashIndex = link.indexOf('#token=');
  if (hashIndex === -1) {
    return null;
  }
  return decodeURIComponent(link.slice(hashIndex + '#token='.length));
}

function uniqueEmail(label: string): string {
  return `job-board-${label}-${randomUUID()}@photoo.test`;
}

function isSnappedToGrid(value: number): boolean {
  return Math.abs(value * 100 - Math.round(value * 100)) < 1e-6;
}

interface JobOfferBody {
  id: string;
  slug: string;
  title: string;
  status: string;
  publishedAt: string | null;
  expiresAt: string | null;
  location: { lat: number; lng: number } | null;
}

interface PublicJobOfferSummaryBody {
  id: string;
  slug: string;
  title: string;
  location: { lat: number; lng: number } | null;
  company: { id: string; companyName: string; verified: boolean; [key: string]: unknown };
}

interface ApplicationBody {
  id: string;
  jobOfferId: string;
  photographerId: string;
  status: string;
}

interface ApplicationWithPhotographerBody extends ApplicationBody {
  photographer: { id: string; slug: string; displayName: string };
}

interface PaginatedBody<T> {
  items: T[];
  nextCursor: string | null;
}

describe('job board integration', () => {
  if (!testEnv) {
    it.skip('skipped: TEST_DATABASE_URL or REDIS_URL is not set', () => undefined);
    return;
  }

  let app: NestFastifyApplication;
  let prisma: PrismaClient;
  let redis: Redis;
  const createdUserIds: string[] = [];
  const createdPhotographerProfileIds: string[] = [];

  function fastify() {
    return app.getHttpAdapter().getInstance();
  }

  function authHeaders(token: string) {
    return { authorization: `Bearer ${token}` };
  }

  async function clearRateLimitKeys(): Promise<void> {
    const globPatterns = [
      `rate-limit:auth:*:${FAKE_IP}`,
      `lockout:auth:*:${FAKE_IP}`,
      ...createdUserIds.map((id) => `rate-limit:job-board:*:${id}`),
      ...createdUserIds.map((id) => `lockout:job-board:*:${id}`),
    ];
    const exactKeys = [
      ...createdPhotographerProfileIds.map((id) => `rate-limit:job-board:apply:photographer:${id}`),
      ...createdPhotographerProfileIds.map((id) => `lockout:job-board:apply:photographer:${id}`),
    ];
    const globbed = (await Promise.all(globPatterns.map((pattern) => redis.keys(pattern)))).flat();
    const keys = [...globbed, ...exactKeys];
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  }

  async function signUpAndSignIn(roles: readonly string[]): Promise<{ token: string; id: string }> {
    const email = uniqueEmail(roles.join('-'));
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
    return { token: body.session.token, id: body.user.id };
  }

  async function createProfessional(suffix: string): Promise<{ token: string; userId: string }> {
    const user = await signUpAndSignIn(['client']);
    await fastify().inject({
      method: 'POST',
      url: '/v1/me/professional-profile',
      headers: authHeaders(user.token),
      payload: { companyName: `Fx JobBoard Co ${suffix}` },
    });
    return { token: user.token, userId: user.id };
  }

  async function createPhotographer(
    suffix: string,
  ): Promise<{ token: string; userId: string; profileId: string }> {
    const user = await signUpAndSignIn(['photographer']);
    const response = await fastify().inject({
      method: 'POST',
      url: '/v1/me/photographer-profile',
      headers: authHeaders(user.token),
      payload: {
        displayName: `Fx JobBoard Photog ${suffix}`,
        categories: ['wedding'],
        languages: ['en'],
        location: { lat: RUN_LAT, lng: RUN_LNG },
        city: `Fx JobBoard Photog City ${suffix}`,
        countryCode: 'LU',
      },
    });
    const profile = response.json<{ id: string }>();
    createdPhotographerProfileIds.push(profile.id);
    return { token: user.token, userId: user.id, profileId: profile.id };
  }

  function offerPayload(overrides: Record<string, unknown> = {}) {
    return {
      title: `Fx Job Offer ${randomUUID().slice(0, 8)}`,
      description: 'Fixture job offer for the job board integration suite.',
      category: 'wedding',
      city: `Fx JobBoard City ${RUN_ID}`,
      countryCode: 'LU',
      location: { lat: RUN_LAT, lng: RUN_LNG },
      remote: false,
      ...overrides,
    };
  }

  async function createDraftOffer(
    token: string,
    overrides: Record<string, unknown> = {},
  ): Promise<JobOfferBody> {
    const response = await fastify().inject({
      method: 'POST',
      url: '/v1/me/job-offers',
      headers: authHeaders(token),
      payload: offerPayload(overrides),
    });
    return response.json<JobOfferBody>();
  }

  async function publishOffer(token: string, id: string) {
    return fastify().inject({
      method: 'POST',
      url: `/v1/me/job-offers/${id}/publish`,
      headers: authHeaders(token),
    });
  }

  async function createPublishedOffer(
    token: string,
    overrides: Record<string, unknown> = {},
  ): Promise<JobOfferBody> {
    const draft = await createDraftOffer(token, overrides);
    const published = await publishOffer(token, draft.id);
    return published.json<JobOfferBody>();
  }

  // Publishing more than 20-30 fixture offers from one account would trip
  // the create (20/day) or publish (10/day) rate limit as a side effect of
  // setting up the apply rate limit fixtures, so tests that need many
  // published offers from the same professional reset both between calls.
  async function resetJobBoardWriteRateLimits(userId: string): Promise<void> {
    await redis.del(
      `rate-limit:job-board:create:account:${userId}`,
      `lockout:job-board:create:account:${userId}`,
      `rate-limit:job-board:publish:account:${userId}`,
      `lockout:job-board:publish:account:${userId}`,
    );
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
      await prisma.jobApplication.deleteMany({
        where: { photographerId: { in: createdPhotographerProfileIds } },
      });
      await prisma.jobOffer.deleteMany({
        where: { professional: { userId: { in: createdUserIds } } },
      });
      await prisma.photographerProfile.deleteMany({
        where: { id: { in: createdPhotographerProfileIds } },
      });
      await prisma.professionalProfile.deleteMany({ where: { userId: { in: createdUserIds } } });
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    await prisma.$disconnect();
    redis.disconnect();
    await app.close();
  });

  describe('POST /v1/me/job-offers', () => {
    it('rejects a caller without the professional role with 403', async () => {
      const client = await signUpAndSignIn(['client']);
      const response = await fastify().inject({
        method: 'POST',
        url: '/v1/me/job-offers',
        headers: authHeaders(client.token),
        payload: offerPayload(),
      });
      expect(response.statusCode).toBe(403);
    });

    it('creates a draft with a server-generated slug', async () => {
      const professional = await createProfessional('create');
      const body = await createDraftOffer(professional.token);
      expect(body.status).toBe('draft');
      expect(body.slug).toMatch(/^[a-z0-9-]+$/);
      expect(body.publishedAt).toBeNull();
    });

    it('works for an unverified account: drafting is not gated, only publishing is', async () => {
      const professional = await createProfessional('create-unverified');
      await prisma.user.update({
        where: { id: professional.userId },
        data: { emailVerifiedAt: null },
      });

      const response = await fastify().inject({
        method: 'POST',
        url: '/v1/me/job-offers',
        headers: authHeaders(professional.token),
        payload: offerPayload(),
      });
      expect(response.statusCode).toBe(201);
    });

    it('rejects a non-remote offer with no location with 400', async () => {
      const professional = await createProfessional('create-no-location');
      const response = await fastify().inject({
        method: 'POST',
        url: '/v1/me/job-offers',
        headers: authHeaders(professional.token),
        payload: offerPayload({ remote: false, location: undefined }),
      });
      expect(response.statusCode).toBe(400);
    });

    it('creates a remote offer with no location, returning a null location', async () => {
      const professional = await createProfessional('create-remote');
      const response = await fastify().inject({
        method: 'POST',
        url: '/v1/me/job-offers',
        headers: authHeaders(professional.token),
        payload: offerPayload({ remote: true, location: undefined }),
      });
      expect(response.statusCode).toBe(201);
      expect(response.json<JobOfferBody>().location).toBeNull();
    });

    it('rate limits draft creation to 20 a day per account, returning 429 with a retry-after detail', async () => {
      const professional = await createProfessional('create-rate-limit');
      let last;
      for (let i = 0; i < 20; i += 1) {
        last = await fastify().inject({
          method: 'POST',
          url: '/v1/me/job-offers',
          headers: authHeaders(professional.token),
          payload: offerPayload(),
        });
        expect(last.statusCode).toBe(201);
      }
      const twentyFirst = await fastify().inject({
        method: 'POST',
        url: '/v1/me/job-offers',
        headers: authHeaders(professional.token),
        payload: offerPayload(),
      });
      expect(twentyFirst.statusCode).toBe(429);
      const body = twentyFirst.json<{ details: { retryAfterSeconds: number } }>();
      expect(body.details.retryAfterSeconds).toBeGreaterThan(0);
    });
  });

  describe('GET/PATCH/DELETE /v1/me/job-offers/:id', () => {
    it("rejects reading another professional's offer with 404", async () => {
      const owner = await createProfessional('owner-read');
      const offer = await createDraftOffer(owner.token);
      const stranger = await createProfessional('stranger-read');

      const response = await fastify().inject({
        method: 'GET',
        url: `/v1/me/job-offers/${offer.id}`,
        headers: authHeaders(stranger.token),
      });
      expect(response.statusCode).toBe(404);
    });

    it('applies a PATCH startDate/endDate check even though the schema carries none', async () => {
      const professional = await createProfessional('patch-dates');
      const offer = await createDraftOffer(professional.token);

      const response = await fastify().inject({
        method: 'PATCH',
        url: `/v1/me/job-offers/${offer.id}`,
        headers: authHeaders(professional.token),
        payload: {
          startDate: '2030-06-10T00:00:00.000Z',
          endDate: '2030-06-01T00:00:00.000Z',
        },
      });
      expect(response.statusCode).toBe(422);
    });

    it('merges a partial PATCH against the existing startDate when only endDate changes', async () => {
      const professional = await createProfessional('patch-merge');
      const offer = await createDraftOffer(professional.token, {
        startDate: '2030-06-01T00:00:00.000Z',
        endDate: '2030-06-10T00:00:00.000Z',
      });

      const response = await fastify().inject({
        method: 'PATCH',
        url: `/v1/me/job-offers/${offer.id}`,
        headers: authHeaders(professional.token),
        payload: { endDate: '2030-05-01T00:00:00.000Z' },
      });
      expect(response.statusCode).toBe(422);
    });

    it('rejects a PATCH that turns off remote and leaves no location, merged against the existing row', async () => {
      const professional = await createProfessional('patch-location-merge');
      const offer = await createDraftOffer(professional.token, {
        remote: true,
        location: undefined,
      });
      expect(offer.location).toBeNull();

      const response = await fastify().inject({
        method: 'PATCH',
        url: `/v1/me/job-offers/${offer.id}`,
        headers: authHeaders(professional.token),
        payload: { remote: false },
      });
      expect(response.statusCode).toBe(422);
    });

    it('accepts a PATCH that sets remote and a location together', async () => {
      const professional = await createProfessional('patch-location-set');
      const offer = await createDraftOffer(professional.token, {
        remote: true,
        location: undefined,
      });

      const response = await fastify().inject({
        method: 'PATCH',
        url: `/v1/me/job-offers/${offer.id}`,
        headers: authHeaders(professional.token),
        payload: { remote: false, location: { lat: RUN_LAT, lng: RUN_LNG } },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json<JobOfferBody>().location).toEqual({ lat: RUN_LAT, lng: RUN_LNG });
    });

    it('deletes an own offer, cascading its applications', async () => {
      const professional = await createProfessional('delete');
      const offer = await createPublishedOffer(professional.token);
      const photographer = await createPhotographer('delete');
      await fastify().inject({
        method: 'POST',
        url: `/v1/job-offers/${offer.id}/applications`,
        headers: authHeaders(photographer.token),
        payload: { message: 'Fixture application before delete.' },
      });

      const response = await fastify().inject({
        method: 'DELETE',
        url: `/v1/me/job-offers/${offer.id}`,
        headers: authHeaders(professional.token),
      });
      expect(response.statusCode).toBe(204);

      const stillThere = await prisma.jobOffer.findUnique({ where: { id: offer.id } });
      expect(stillThere).toBeNull();
      const applications = await prisma.jobApplication.findMany({
        where: { jobOfferId: offer.id },
      });
      expect(applications).toHaveLength(0);
    });
  });

  describe('POST /v1/me/job-offers/:id/publish', () => {
    it('rejects an unverified account with EMAIL_NOT_VERIFIED, then succeeds once verified', async () => {
      const professional = await createProfessional('publish-unverified');
      const draft = await createDraftOffer(professional.token);
      await prisma.user.update({
        where: { id: professional.userId },
        data: { emailVerifiedAt: null },
      });

      const blocked = await publishOffer(professional.token, draft.id);
      expect(blocked.statusCode).toBe(403);
      expect(blocked.json<{ code: string }>().code).toBe('EMAIL_NOT_VERIFIED');

      await prisma.user.update({
        where: { id: professional.userId },
        data: { emailVerifiedAt: new Date() },
      });

      const allowed = await publishOffer(professional.token, draft.id);
      expect(allowed.statusCode).toBe(200);
    });

    it('never burns the daily publish budget on ids that do not exist', async () => {
      const professional = await createProfessional('publish-probe');
      for (let i = 0; i < 15; i += 1) {
        const response = await publishOffer(professional.token, randomUUID());
        expect(response.statusCode).toBe(404);
      }

      const draft = await createDraftOffer(professional.token);
      const response = await publishOffer(professional.token, draft.id);
      expect(response.statusCode).toBe(200);
    });

    it('sets publishedAt, expiresAt about 60 days out, and creates a free listing', async () => {
      const professional = await createProfessional('publish');
      const draft = await createDraftOffer(professional.token);

      const response = await publishOffer(professional.token, draft.id);
      expect(response.statusCode).toBe(200);
      const body = response.json<JobOfferBody>();
      expect(body.status).toBe('published');
      expect(body.publishedAt).not.toBeNull();

      const offerRow = await prisma.jobOffer.findUniqueOrThrow({ where: { id: draft.id } });
      expect(offerRow.listingId).not.toBeNull();
      const listing = await prisma.listing.findUniqueOrThrow({
        where: { id: offerRow.listingId ?? '' },
      });
      expect(listing.plan).toBe('free');
      expect(listing.priceCents).toBe(0);
      const daysUntilExpiry = (listing.expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
      expect(daysUntilExpiry).toBeGreaterThan(58);
      expect(daysUntilExpiry).toBeLessThan(61);
    });

    it('rejects publishing an already-published offer with 409', async () => {
      const professional = await createProfessional('publish-twice');
      const offer = await createPublishedOffer(professional.token);

      const response = await publishOffer(professional.token, offer.id);
      expect(response.statusCode).toBe(409);
    });

    it('leaves exactly one listing when the same offer is published twice concurrently', async () => {
      const professional = await createProfessional('publish-concurrent');
      const draft = await createDraftOffer(professional.token);

      const [first, second] = await Promise.all([
        publishOffer(professional.token, draft.id),
        publishOffer(professional.token, draft.id),
      ]);
      const statuses = [first.statusCode, second.statusCode].sort();
      expect(statuses).toEqual([200, 409]);

      const listingCount = await prisma.listing.count({ where: { ownerId: draft.id } });
      expect(listingCount).toBe(1);

      const offerRow = await prisma.jobOffer.findUniqueOrThrow({ where: { id: draft.id } });
      const listing = await prisma.listing.findUniqueOrThrow({
        where: { id: offerRow.listingId ?? '' },
      });
      expect(listing.ownerId).toBe(draft.id);
    });

    it('creates a new listing rather than extending the old one when re-publishing a closed offer', async () => {
      const professional = await createProfessional('republish');
      const offer = await createPublishedOffer(professional.token);
      const firstListingId = (await prisma.jobOffer.findUniqueOrThrow({ where: { id: offer.id } }))
        .listingId;

      await fastify().inject({
        method: 'POST',
        url: `/v1/me/job-offers/${offer.id}/close`,
        headers: authHeaders(professional.token),
      });
      const republished = await publishOffer(professional.token, offer.id);
      expect(republished.statusCode).toBe(200);

      const secondListingId = (await prisma.jobOffer.findUniqueOrThrow({ where: { id: offer.id } }))
        .listingId;
      expect(secondListingId).not.toBe(firstListingId);

      const listingCount = await prisma.listing.count({ where: { ownerId: offer.id } });
      expect(listingCount).toBe(2);
    });

    it('rate limits publishing to 10 a day per account, returning 429 with a retry-after detail', async () => {
      const professional = await createProfessional('publish-rate-limit');
      let last;
      for (let i = 0; i < 10; i += 1) {
        const draft = await createDraftOffer(professional.token);
        last = await publishOffer(professional.token, draft.id);
        expect(last.statusCode).toBe(200);
      }
      const eleventhDraft = await createDraftOffer(professional.token);
      const eleventh = await publishOffer(professional.token, eleventhDraft.id);
      expect(eleventh.statusCode).toBe(429);
      const body = eleventh.json<{ details: { retryAfterSeconds: number } }>();
      expect(body.details.retryAfterSeconds).toBeGreaterThan(0);
    });
  });

  describe('POST /v1/me/job-offers/:id/close', () => {
    it('rejects closing an offer that is not published with 409', async () => {
      const professional = await createProfessional('close-not-published');
      const draft = await createDraftOffer(professional.token);

      const response = await fastify().inject({
        method: 'POST',
        url: `/v1/me/job-offers/${draft.id}/close`,
        headers: authHeaders(professional.token),
      });
      expect(response.statusCode).toBe(409);
    });
  });

  describe('GET /v1/job-offers (public)', () => {
    it('never returns a draft offer, and 404s it by slug', async () => {
      const professional = await createProfessional('draft-hidden');
      const draft = await createDraftOffer(professional.token);

      const list = await fastify().inject({ method: 'GET', url: '/v1/job-offers?limit=100' });
      const ids = list.json<PaginatedBody<PublicJobOfferSummaryBody>>().items.map((i) => i.id);
      expect(ids).not.toContain(draft.id);

      const bySlug = await fastify().inject({ method: 'GET', url: `/v1/job-offers/${draft.slug}` });
      expect(bySlug.statusCode).toBe(404);
    });

    it('disappears from the public list and by slug once expired, before the sweep has run', async () => {
      const professional = await createProfessional('lapsed');
      const offer = await createPublishedOffer(professional.token);

      await prisma.jobOffer.update({
        where: { id: offer.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      const list = await fastify().inject({ method: 'GET', url: '/v1/job-offers?limit=100' });
      const ids = list.json<PaginatedBody<PublicJobOfferSummaryBody>>().items.map((i) => i.id);
      expect(ids).not.toContain(offer.id);

      const bySlug = await fastify().inject({ method: 'GET', url: `/v1/job-offers/${offer.slug}` });
      expect(bySlug.statusCode).toBe(404);

      const stillPublishedInDb = await prisma.jobOffer.findUniqueOrThrow({
        where: { id: offer.id },
      });
      expect(stillPublishedInDb.status).toBe('published');
    });

    it('never leaks the company email, phone or VAT number in the serialised body', async () => {
      const professional = await createProfessional('no-pii');
      await fastify().inject({
        method: 'PATCH',
        url: '/v1/me/professional-profile',
        headers: authHeaders(professional.token),
        payload: { vatNumber: 'LU00000000' },
      });
      const offer = await createPublishedOffer(professional.token);

      const detail = await fastify().inject({
        method: 'GET',
        url: `/v1/job-offers/${offer.slug}`,
      });
      const raw = detail.body;
      expect(raw).not.toContain('LU00000000');
      expect(raw).not.toContain('vatNumber');
      expect(raw).not.toContain('phone');
      const user = await prisma.user.findUniqueOrThrow({ where: { id: professional.userId } });
      expect(raw).not.toContain(user.email);

      const list = await fastify().inject({ method: 'GET', url: '/v1/job-offers?limit=100' });
      expect(list.body).not.toContain('LU00000000');
      expect(list.body).not.toContain(user.email);
    });

    it('a remote offer matches a city filter regardless of its own city', async () => {
      const professional = await createProfessional('remote-match');
      const offer = await createPublishedOffer(professional.token, {
        remote: true,
        city: `Fx Remote Elsewhere ${RUN_ID}`,
      });

      const response = await fastify().inject({
        method: 'GET',
        url: `/v1/job-offers?city=${encodeURIComponent(`Fx JobBoard City ${RUN_ID}`)}&limit=100`,
      });
      const ids = response.json<PaginatedBody<PublicJobOfferSummaryBody>>().items.map((i) => i.id);
      expect(ids).toContain(offer.id);
    });

    it('snaps the location to the coarsening grid for public reads but keeps the owner view exact', async () => {
      const professional = await createProfessional('location-privacy');
      const preciseLocation = { lat: RUN_LAT + 0.00345, lng: RUN_LNG + 0.00678 };
      const offer = await createPublishedOffer(professional.token, { location: preciseLocation });

      const ownView = await fastify().inject({
        method: 'GET',
        url: `/v1/me/job-offers/${offer.id}`,
        headers: authHeaders(professional.token),
      });
      const ownLocation = ownView.json<JobOfferBody>().location;
      expect(ownLocation?.lat).toBeCloseTo(preciseLocation.lat, 5);
      expect(ownLocation?.lng).toBeCloseTo(preciseLocation.lng, 5);

      const summary = await fastify().inject({ method: 'GET', url: '/v1/job-offers?limit=100' });
      const summaryOffer = summary
        .json<PaginatedBody<PublicJobOfferSummaryBody>>()
        .items.find((item) => item.id === offer.id);
      expect(summaryOffer?.location?.lat).not.toBeCloseTo(preciseLocation.lat, 3);
      expect(isSnappedToGrid(summaryOffer?.location?.lat ?? NaN)).toBe(true);
      expect(isSnappedToGrid(summaryOffer?.location?.lng ?? NaN)).toBe(true);

      const detail = await fastify().inject({
        method: 'GET',
        url: `/v1/job-offers/${offer.slug}`,
      });
      const detailLocation = detail.json<PublicJobOfferSummaryBody>().location;
      expect(detailLocation?.lat).not.toBeCloseTo(preciseLocation.lat, 3);
      expect(isSnappedToGrid(detailLocation?.lat ?? NaN)).toBe(true);
      expect(isSnappedToGrid(detailLocation?.lng ?? NaN)).toBe(true);
    });

    it('matches a % or _ in the title literally instead of as a wildcard', async () => {
      const professional = await createProfessional('q-wildcard');
      const offer = await createPublishedOffer(professional.token, {
        title: `Fx Wildcard 100% Q_${RUN_ID}`,
      });
      await createPublishedOffer(professional.token, {
        title: `Fx Wildcard 100X QY${RUN_ID}`,
      });

      const response = await fastify().inject({
        method: 'GET',
        url: `/v1/job-offers?q=${encodeURIComponent(`100% Q_${RUN_ID}`)}&limit=100`,
      });
      const ids = response.json<PaginatedBody<PublicJobOfferSummaryBody>>().items.map((i) => i.id);
      expect(ids).toContain(offer.id);
      expect(ids).toHaveLength(1);
    });

    it('treats a malformed cursor as 400, not 500', async () => {
      const response = await fastify().inject({
        method: 'GET',
        url: `/v1/job-offers?cursor=${encodeURIComponent('\'; DROP TABLE "JobOffer"; --')}`,
      });
      expect(response.statusCode).toBe(400);

      const stillWorks = await fastify().inject({ method: 'GET', url: '/v1/job-offers' });
      expect(stillWorks.statusCode).toBe(200);
    });

    it('paginates the public list with no gaps or repeats', async () => {
      const professional = await createProfessional('paginate');
      const city = `Fx Paginate City ${RUN_ID}`;
      const created: string[] = [];
      for (let i = 0; i < 3; i += 1) {
        const offer = await createPublishedOffer(professional.token, { city });
        created.push(offer.id);
      }

      const seen: string[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < 5; page += 1) {
        const url: string = cursor
          ? `/v1/job-offers?city=${encodeURIComponent(city)}&remote=false&limit=1&cursor=${cursor}`
          : `/v1/job-offers?city=${encodeURIComponent(city)}&remote=false&limit=1`;
        const response = await fastify().inject({ method: 'GET', url });
        const body = response.json<PaginatedBody<PublicJobOfferSummaryBody>>();
        seen.push(...body.items.map((item) => item.id));
        if (!body.nextCursor) {
          break;
        }
        cursor = body.nextCursor;
      }

      expect(new Set(seen).size).toBe(seen.length);
      expect(seen.sort()).toEqual([...created].sort());
    });
  });

  describe('POST /v1/job-offers/:id/applications', () => {
    it('rejects an unverified account with EMAIL_NOT_VERIFIED, then succeeds once verified', async () => {
      const professional = await createProfessional('apply-unverified-offer');
      const offer = await createPublishedOffer(professional.token);
      const photographer = await createPhotographer('apply-unverified');
      await prisma.user.update({
        where: { id: photographer.userId },
        data: { emailVerifiedAt: null },
      });

      const blocked = await fastify().inject({
        method: 'POST',
        url: `/v1/job-offers/${offer.id}/applications`,
        headers: authHeaders(photographer.token),
        payload: { message: 'Fixture application.' },
      });
      expect(blocked.statusCode).toBe(403);
      expect(blocked.json<{ code: string }>().code).toBe('EMAIL_NOT_VERIFIED');

      await prisma.user.update({
        where: { id: photographer.userId },
        data: { emailVerifiedAt: new Date() },
      });

      const allowed = await fastify().inject({
        method: 'POST',
        url: `/v1/job-offers/${offer.id}/applications`,
        headers: authHeaders(photographer.token),
        payload: { message: 'Fixture application.' },
      });
      expect(allowed.statusCode).toBe(201);
    });

    it('rejects a caller without the photographer role with 403', async () => {
      const professional = await createProfessional('apply-role');
      const offer = await createPublishedOffer(professional.token);
      const client = await signUpAndSignIn(['client']);

      const response = await fastify().inject({
        method: 'POST',
        url: `/v1/job-offers/${offer.id}/applications`,
        headers: authHeaders(client.token),
        payload: { message: 'Fixture application.' },
      });
      expect(response.statusCode).toBe(403);
    });

    it('rejects applying to a non-existent offer with 404', async () => {
      const photographer = await createPhotographer('apply-missing');
      const response = await fastify().inject({
        method: 'POST',
        url: `/v1/job-offers/${randomUUID()}/applications`,
        headers: authHeaders(photographer.token),
        payload: { message: 'Fixture application.' },
      });
      expect(response.statusCode).toBe(404);
    });

    it('never burns the daily apply budget on offers that do not exist', async () => {
      const photographer = await createPhotographer('apply-probe');
      for (let i = 0; i < 35; i += 1) {
        const response = await fastify().inject({
          method: 'POST',
          url: `/v1/job-offers/${randomUUID()}/applications`,
          headers: authHeaders(photographer.token),
          payload: { message: 'Fixture application.' },
        });
        expect(response.statusCode).toBe(404);
      }

      const professional = await createProfessional('apply-probe-owner');
      const offer = await createPublishedOffer(professional.token);
      const response = await fastify().inject({
        method: 'POST',
        url: `/v1/job-offers/${offer.id}/applications`,
        headers: authHeaders(photographer.token),
        payload: { message: 'A genuine application after probing dead ids.' },
      });
      expect(response.statusCode).toBe(201);
    });

    it('rejects applying to a draft offer with 409', async () => {
      const professional = await createProfessional('apply-draft');
      const draft = await createDraftOffer(professional.token);
      const photographer = await createPhotographer('apply-draft');

      const response = await fastify().inject({
        method: 'POST',
        url: `/v1/job-offers/${draft.id}/applications`,
        headers: authHeaders(photographer.token),
        payload: { message: 'Fixture application.' },
      });
      expect(response.statusCode).toBe(409);
    });

    it('creates an application and notifies the professional', async () => {
      const professional = await createProfessional('apply-success');
      const offer = await createPublishedOffer(professional.token);
      const photographer = await createPhotographer('apply-success');

      const response = await fastify().inject({
        method: 'POST',
        url: `/v1/job-offers/${offer.id}/applications`,
        headers: authHeaders(photographer.token),
        payload: {
          message: 'I would love to shoot this.',
          portfolioLink: 'https://example.com/portfolio',
        },
      });
      expect(response.statusCode).toBe(201);
      const body = response.json<ApplicationBody>();
      expect(body.status).toBe('submitted');

      const notifications = await prisma.notification.findMany({
        where: { userId: professional.userId, type: 'job_application_received' },
      });
      expect(
        notifications.some((n) => (n.payload as { jobOfferId?: string }).jobOfferId === offer.id),
      ).toBe(true);
    });

    it('rejects a second application to the same offer with 409', async () => {
      const professional = await createProfessional('apply-duplicate');
      const offer = await createPublishedOffer(professional.token);
      const photographer = await createPhotographer('apply-duplicate');

      const first = await fastify().inject({
        method: 'POST',
        url: `/v1/job-offers/${offer.id}/applications`,
        headers: authHeaders(photographer.token),
        payload: { message: 'First application.' },
      });
      expect(first.statusCode).toBe(201);

      const second = await fastify().inject({
        method: 'POST',
        url: `/v1/job-offers/${offer.id}/applications`,
        headers: authHeaders(photographer.token),
        payload: { message: 'Second application.' },
      });
      expect(second.statusCode).toBe(409);
    });

    it('rate limits applications to 30 a day per photographer, returning 429 with a retry-after detail', async () => {
      const photographer = await createPhotographer('apply-rate-limit');
      const professional = await createProfessional('apply-rate-limit-owner');
      let last;
      for (let i = 0; i < 30; i += 1) {
        await resetJobBoardWriteRateLimits(professional.userId);
        const offer = await createPublishedOffer(professional.token);
        last = await fastify().inject({
          method: 'POST',
          url: `/v1/job-offers/${offer.id}/applications`,
          headers: authHeaders(photographer.token),
          payload: { message: `Application ${String(i)}.` },
        });
        expect(last.statusCode).toBe(201);
      }
      const oneMoreOffer = await createPublishedOffer(professional.token);
      const overflow = await fastify().inject({
        method: 'POST',
        url: `/v1/job-offers/${oneMoreOffer.id}/applications`,
        headers: authHeaders(photographer.token),
        payload: { message: 'One too many.' },
      });
      expect(overflow.statusCode).toBe(429);
      const body = overflow.json<{ details: { retryAfterSeconds: number } }>();
      expect(body.details.retryAfterSeconds).toBeGreaterThan(0);
    });
  });

  describe('GET /v1/job-offers/:id/applications', () => {
    it('lists applications received for an own offer, hiding it from a stranger with 404', async () => {
      const professional = await createProfessional('received-owner');
      const offer = await createPublishedOffer(professional.token);
      const photographer = await createPhotographer('received');
      await fastify().inject({
        method: 'POST',
        url: `/v1/job-offers/${offer.id}/applications`,
        headers: authHeaders(photographer.token),
        payload: { message: 'Fixture application.' },
      });

      const owned = await fastify().inject({
        method: 'GET',
        url: `/v1/job-offers/${offer.id}/applications`,
        headers: authHeaders(professional.token),
      });
      expect(owned.statusCode).toBe(200);
      expect(owned.json<PaginatedBody<ApplicationBody>>().items).toHaveLength(1);

      const stranger = await createProfessional('received-stranger');
      const forbidden = await fastify().inject({
        method: 'GET',
        url: `/v1/job-offers/${offer.id}/applications`,
        headers: authHeaders(stranger.token),
      });
      expect(forbidden.statusCode).toBe(404);
    });

    it('exposes neither the slug nor the display name of an anonymised applicant', async () => {
      const professional = await createProfessional('received-anon');
      const offer = await createPublishedOffer(professional.token);
      const photographer = await createPhotographer('received-anon');
      await fastify().inject({
        method: 'POST',
        url: `/v1/job-offers/${offer.id}/applications`,
        headers: authHeaders(photographer.token),
        payload: { message: 'Fixture application.' },
      });

      await prisma.photographerProfile.update({
        where: { id: photographer.profileId },
        data: {
          slug: `deleted-${photographer.profileId}`,
          displayName: 'Deleted user',
          headline: null,
          bio: {},
          links: [],
          languages: [],
        },
      });

      const received = await fastify().inject({
        method: 'GET',
        url: `/v1/job-offers/${offer.id}/applications`,
        headers: authHeaders(professional.token),
      });
      expect(received.statusCode).toBe(200);
      const items = received.json<PaginatedBody<ApplicationWithPhotographerBody>>().items;
      expect(items).toHaveLength(1);
      const [item] = items;
      expect(item?.photographer.displayName).toBe('Deleted user');
      expect(item?.photographer.slug).toBe(`deleted-${photographer.profileId}`);
      expect(item?.photographer.slug).not.toContain('received-anon');
      expect(item?.photographer.displayName).not.toMatch(/Fx JobBoard Photog/i);
      expect(item?.photographer.slug).not.toMatch(/Fx JobBoard Photog/i);
    });
  });

  describe('POST /v1/job-applications/:id/status', () => {
    async function applyFixture(suffix: string) {
      const professional = await createProfessional(`status-${suffix}`);
      const offer = await createPublishedOffer(professional.token);
      const photographer = await createPhotographer(`status-${suffix}`);
      const applyResponse = await fastify().inject({
        method: 'POST',
        url: `/v1/job-offers/${offer.id}/applications`,
        headers: authHeaders(photographer.token),
        payload: { message: 'Fixture application.' },
      });
      const application = applyResponse.json<ApplicationBody>();
      return { professional, offer, photographer, application };
    }

    it('lets an unverified professional shortlist an application: managing existing applications is not gated', async () => {
      const { professional, application } = await applyFixture('shortlist-unverified');
      await prisma.user.update({
        where: { id: professional.userId },
        data: { emailVerifiedAt: null },
      });

      const response = await fastify().inject({
        method: 'POST',
        url: `/v1/job-applications/${application.id}/status`,
        headers: authHeaders(professional.token),
        payload: { status: 'shortlisted' },
      });
      expect(response.statusCode).toBe(200);
    });

    it('lets the professional shortlist an application', async () => {
      const { professional, application } = await applyFixture('shortlist');
      const response = await fastify().inject({
        method: 'POST',
        url: `/v1/job-applications/${application.id}/status`,
        headers: authHeaders(professional.token),
        payload: { status: 'shortlisted' },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json<ApplicationBody>().status).toBe('shortlisted');
    });

    it('rejects a photographer trying to shortlist their own application with 403', async () => {
      const { photographer, application } = await applyFixture('forbidden-shortlist');
      const response = await fastify().inject({
        method: 'POST',
        url: `/v1/job-applications/${application.id}/status`,
        headers: authHeaders(photographer.token),
        payload: { status: 'shortlisted' },
      });
      expect(response.statusCode).toBe(403);
    });

    it('lets the photographer withdraw their own application without notifying the professional', async () => {
      const { professional, photographer, application } = await applyFixture('withdraw');
      const response = await fastify().inject({
        method: 'POST',
        url: `/v1/job-applications/${application.id}/status`,
        headers: authHeaders(photographer.token),
        payload: { status: 'withdrawn' },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json<ApplicationBody>().status).toBe('withdrawn');

      const notifications = await prisma.notification.findMany({
        where: { userId: professional.userId, type: 'job_application_status_changed' },
      });
      expect(
        notifications.some(
          (n) => (n.payload as { jobApplicationId?: string }).jobApplicationId === application.id,
        ),
      ).toBe(false);
    });

    it('rejects the professional trying to withdraw an application with 403', async () => {
      const { professional, application } = await applyFixture('forbidden-withdraw');
      const response = await fastify().inject({
        method: 'POST',
        url: `/v1/job-applications/${application.id}/status`,
        headers: authHeaders(professional.token),
        payload: { status: 'withdrawn' },
      });
      expect(response.statusCode).toBe(403);
    });

    it('rejects an unrelated caller with 404', async () => {
      const { application } = await applyFixture('unrelated');
      const stranger = await signUpAndSignIn(['client']);
      const response = await fastify().inject({
        method: 'POST',
        url: `/v1/job-applications/${application.id}/status`,
        headers: authHeaders(stranger.token),
        payload: { status: 'withdrawn' },
      });
      expect(response.statusCode).toBe(404);
    });

    it('rejects a second status change on the same application with 409', async () => {
      const { professional, application } = await applyFixture('already-processed');
      await fastify().inject({
        method: 'POST',
        url: `/v1/job-applications/${application.id}/status`,
        headers: authHeaders(professional.token),
        payload: { status: 'rejected' },
      });

      const response = await fastify().inject({
        method: 'POST',
        url: `/v1/job-applications/${application.id}/status`,
        headers: authHeaders(professional.token),
        payload: { status: 'shortlisted' },
      });
      expect(response.statusCode).toBe(409);
    });
  });

  describe('GET /v1/me/job-applications', () => {
    it("lists the caller's own applications with the offer summary embedded", async () => {
      const professional = await createProfessional('mine-owner');
      const offer = await createPublishedOffer(professional.token);
      const photographer = await createPhotographer('mine');
      await fastify().inject({
        method: 'POST',
        url: `/v1/job-offers/${offer.id}/applications`,
        headers: authHeaders(photographer.token),
        payload: { message: 'Fixture application.' },
      });

      const response = await fastify().inject({
        method: 'GET',
        url: '/v1/me/job-applications',
        headers: authHeaders(photographer.token),
      });
      expect(response.statusCode).toBe(200);
      const items = response.json<PaginatedBody<{ jobOffer: { id: string } }>>().items;
      expect(items.some((item) => item.jobOffer.id === offer.id)).toBe(true);
    });
  });

  describe('moderation takedown (deletedAt)', () => {
    it("hides a taken-down offer from the public list, 404s it by slug, and drops it from the owner's own list and detail", async () => {
      const professional = await createProfessional('moderated-offer');
      const offer = await createPublishedOffer(professional.token);

      const listBefore = await fastify().inject({ method: 'GET', url: '/v1/job-offers?limit=100' });
      expect(
        listBefore.json<PaginatedBody<PublicJobOfferSummaryBody>>().items.map((i) => i.id),
      ).toContain(offer.id);
      const ownListBefore = await fastify().inject({
        method: 'GET',
        url: '/v1/me/job-offers?limit=100',
        headers: authHeaders(professional.token),
      });
      expect(ownListBefore.json<PaginatedBody<JobOfferBody>>().items.map((i) => i.id)).toContain(
        offer.id,
      );

      await prisma.jobOffer.update({ where: { id: offer.id }, data: { deletedAt: new Date() } });

      const list = await fastify().inject({ method: 'GET', url: '/v1/job-offers?limit=100' });
      expect(
        list.json<PaginatedBody<PublicJobOfferSummaryBody>>().items.map((i) => i.id),
      ).not.toContain(offer.id);

      const bySlug = await fastify().inject({ method: 'GET', url: `/v1/job-offers/${offer.slug}` });
      expect(bySlug.statusCode).toBe(404);

      const ownList = await fastify().inject({
        method: 'GET',
        url: '/v1/me/job-offers?limit=100',
        headers: authHeaders(professional.token),
      });
      expect(ownList.json<PaginatedBody<JobOfferBody>>().items.map((i) => i.id)).not.toContain(
        offer.id,
      );

      const ownDetail = await fastify().inject({
        method: 'GET',
        url: `/v1/me/job-offers/${offer.id}`,
        headers: authHeaders(professional.token),
      });
      expect(ownDetail.statusCode).toBe(404);
    });

    it('refuses an application to a taken-down offer with 409', async () => {
      const professional = await createProfessional('moderated-offer-apply');
      const offer = await createPublishedOffer(professional.token);
      const photographer = await createPhotographer('moderated-offer-apply');

      await prisma.jobOffer.update({ where: { id: offer.id }, data: { deletedAt: new Date() } });

      const response = await fastify().inject({
        method: 'POST',
        url: `/v1/job-offers/${offer.id}/applications`,
        headers: authHeaders(photographer.token),
        payload: { message: 'Should be refused.' },
      });
      expect(response.statusCode).toBe(409);
    });

    it("clearing an offer's deletedAt restores its visibility everywhere, proving restore will work", async () => {
      const professional = await createProfessional('moderated-offer-restore');
      const offer = await createPublishedOffer(professional.token);

      await prisma.jobOffer.update({ where: { id: offer.id }, data: { deletedAt: new Date() } });
      const hiddenBySlug = await fastify().inject({
        method: 'GET',
        url: `/v1/job-offers/${offer.slug}`,
      });
      expect(hiddenBySlug.statusCode).toBe(404);

      await prisma.jobOffer.update({ where: { id: offer.id }, data: { deletedAt: null } });

      const restoredBySlug = await fastify().inject({
        method: 'GET',
        url: `/v1/job-offers/${offer.slug}`,
      });
      expect(restoredBySlug.statusCode).toBe(200);

      const restoredOwnDetail = await fastify().inject({
        method: 'GET',
        url: `/v1/me/job-offers/${offer.id}`,
        headers: authHeaders(professional.token),
      });
      expect(restoredOwnDetail.statusCode).toBe(200);

      const list = await fastify().inject({ method: 'GET', url: '/v1/job-offers?limit=100' });
      expect(
        list.json<PaginatedBody<PublicJobOfferSummaryBody>>().items.map((i) => i.id),
      ).toContain(offer.id);
    });

    it('hides a taken-down application from both listReceived and listMine, and restores it once deletedAt is cleared', async () => {
      const professional = await createProfessional('moderated-application');
      const offer = await createPublishedOffer(professional.token);
      const photographer = await createPhotographer('moderated-application');
      const applyResponse = await fastify().inject({
        method: 'POST',
        url: `/v1/job-offers/${offer.id}/applications`,
        headers: authHeaders(photographer.token),
        payload: { message: 'Fixture application to be moderated.' },
      });
      const application = applyResponse.json<ApplicationBody>();

      await prisma.jobApplication.update({
        where: { id: application.id },
        data: { deletedAt: new Date() },
      });

      const receivedHidden = await fastify().inject({
        method: 'GET',
        url: `/v1/job-offers/${offer.id}/applications`,
        headers: authHeaders(professional.token),
      });
      expect(
        receivedHidden.json<PaginatedBody<ApplicationBody>>().items.map((i) => i.id),
      ).not.toContain(application.id);

      const mineHidden = await fastify().inject({
        method: 'GET',
        url: '/v1/me/job-applications',
        headers: authHeaders(photographer.token),
      });
      expect(mineHidden.json<PaginatedBody<{ id: string }>>().items.map((i) => i.id)).not.toContain(
        application.id,
      );

      await prisma.jobApplication.update({
        where: { id: application.id },
        data: { deletedAt: null },
      });

      const receivedRestored = await fastify().inject({
        method: 'GET',
        url: `/v1/job-offers/${offer.id}/applications`,
        headers: authHeaders(professional.token),
      });
      expect(
        receivedRestored.json<PaginatedBody<ApplicationBody>>().items.map((i) => i.id),
      ).toContain(application.id);

      const mineRestored = await fastify().inject({
        method: 'GET',
        url: '/v1/me/job-applications',
        headers: authHeaders(photographer.token),
      });
      expect(mineRestored.json<PaginatedBody<{ id: string }>>().items.map((i) => i.id)).toContain(
        application.id,
      );
    });

    it('treats a taken-down application as not-found for a status change', async () => {
      const professional = await createProfessional('moderated-application-status');
      const offer = await createPublishedOffer(professional.token);
      const photographer = await createPhotographer('moderated-application-status');
      const applyResponse = await fastify().inject({
        method: 'POST',
        url: `/v1/job-offers/${offer.id}/applications`,
        headers: authHeaders(photographer.token),
        payload: { message: 'Fixture application.' },
      });
      const application = applyResponse.json<ApplicationBody>();

      await prisma.jobApplication.update({
        where: { id: application.id },
        data: { deletedAt: new Date() },
      });

      const response = await fastify().inject({
        method: 'POST',
        url: `/v1/job-applications/${application.id}/status`,
        headers: authHeaders(professional.token),
        payload: { status: 'shortlisted' },
      });
      expect(response.statusCode).toBe(404);
    });

    it('does not interfere with GDPR erasure: a takedown survives closure, and a hypothetical restore never reopens it', async () => {
      const professional = await createProfessional('moderation-gdpr-orthogonal');
      const offer = await createPublishedOffer(professional.token);

      await prisma.jobOffer.update({ where: { id: offer.id }, data: { deletedAt: new Date() } });

      const deletion = await fastify().inject({
        method: 'POST',
        url: '/v1/me/data-requests',
        headers: { ...authHeaders(professional.token), origin: 'http://localhost:3000' },
        payload: { type: 'delete' },
      });
      expect(deletion.statusCode).toBe(201);

      const afterErasure = await prisma.jobOffer.findUniqueOrThrow({ where: { id: offer.id } });
      expect(afterErasure.status).toBe('closed');
      expect(afterErasure.deletedAt).not.toBeNull();

      await prisma.jobOffer.update({ where: { id: offer.id }, data: { deletedAt: null } });
      const afterHypotheticalRestore = await prisma.jobOffer.findUniqueOrThrow({
        where: { id: offer.id },
      });
      expect(afterHypotheticalRestore.status).toBe('closed');

      const publicList = await fastify().inject({ method: 'GET', url: '/v1/job-offers?limit=100' });
      expect(
        publicList.json<PaginatedBody<PublicJobOfferSummaryBody>>().items.map((i) => i.id),
      ).not.toContain(offer.id);
    });
  });

  describe('GDPR account deletion', () => {
    it("closes the professional's published offers and withdraws the photographer's submitted applications, removing the offer from the public endpoints", async () => {
      const professional = await createProfessional('gdpr-professional');
      const offer = await createPublishedOffer(professional.token);

      const photographer = await createPhotographer('gdpr-photographer');
      const applyResponse = await fastify().inject({
        method: 'POST',
        url: `/v1/job-offers/${offer.id}/applications`,
        headers: authHeaders(photographer.token),
        payload: { message: 'Fixture application.' },
      });
      const application = applyResponse.json<ApplicationBody>();

      const beforePublicGet = await fastify().inject({
        method: 'GET',
        url: `/v1/job-offers/${offer.slug}`,
      });
      expect(beforePublicGet.statusCode).toBe(200);

      const professionalDeletion = await fastify().inject({
        method: 'POST',
        url: '/v1/me/data-requests',
        headers: { ...authHeaders(professional.token), origin: 'http://localhost:3000' },
        payload: { type: 'delete' },
      });
      expect(professionalDeletion.statusCode).toBe(201);

      const offerAfter = await prisma.jobOffer.findUniqueOrThrow({ where: { id: offer.id } });
      expect(offerAfter.status).toBe('closed');

      const publicGetAfter = await fastify().inject({
        method: 'GET',
        url: `/v1/job-offers/${offer.slug}`,
      });
      expect(publicGetAfter.statusCode).toBe(404);

      const publicListAfter = await fastify().inject({
        method: 'GET',
        url: `/v1/job-offers?countryCode=LU&city=${encodeURIComponent(`Fx JobBoard City ${RUN_ID}`)}`,
      });
      expect(publicListAfter.statusCode).toBe(200);
      const listItems = publicListAfter.json<PaginatedBody<{ id: string }>>().items;
      expect(listItems.some((item) => item.id === offer.id)).toBe(false);

      const photographerDeletion = await fastify().inject({
        method: 'POST',
        url: '/v1/me/data-requests',
        headers: { ...authHeaders(photographer.token), origin: 'http://localhost:3000' },
        payload: { type: 'delete' },
      });
      expect(photographerDeletion.statusCode).toBe(201);

      const applicationAfter = await prisma.jobApplication.findUniqueOrThrow({
        where: { id: application.id },
      });
      expect(applicationAfter.status).toBe('withdrawn');
    });
  });
});
