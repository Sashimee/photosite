import { randomUUID } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createPrismaClient, type PrismaClient } from '@photoo/db';
import { Redis } from 'ioredis';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../../testing/create-test-app.js';
import { waitForLinkInEmail } from '../../testing/mailpit.js';
import { requireIntegrationEnv } from '../../testing/require-integration-env.js';
import { TEST_ENV } from '../../testing/test-env.js';

function extractFragmentToken(link: string): string | null {
  const hashIndex = link.indexOf('#token=');
  if (hashIndex === -1) {
    return null;
  }
  return decodeURIComponent(link.slice(hashIndex + '#token='.length));
}

const testEnv = requireIntegrationEnv(['TEST_DATABASE_URL', 'REDIS_URL']);
const PASSWORD = `photoo-test-${randomUUID()}`;

interface PaginatedBody<T> {
  items: T[];
  nextCursor: string | null;
}

interface SummaryBody {
  id: string;
  slug: string;
  city: string;
  categories: string[];
  languages: string[];
}

interface OwnProfileBody {
  id: string;
  slug: string;
  isPublished: boolean;
  avatarUrl: string | null;
}

interface PortfolioImageBody {
  id: string;
  status: string;
  order: number;
  url: string | null;
  width: number | null;
  height: number | null;
}

function uniqueEmail(label: string): string {
  return `profiles-${label}-${randomUUID()}@photoo.test`;
}

function decodeOpaqueCursor(cursor: string): { mode: string; value: number; id: string } {
  return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
    mode: string;
    value: number;
    id: string;
  };
}

// Derived from RUN_ID and kept in a remote North Atlantic box, far from
// Luxembourg, from products.integration.test.ts's fixed Sydney fixture, and
// from quotes/requests's own random Pacific box (issue #50), so radius/order
// assertions only ever see this suite's own data even when a previous run's
// fixtures were never cleaned up (issue #97). RUN_ID keeps slugs/cities
// unique across repeated runs.
const RUN_ID = randomUUID().replaceAll('-', '').slice(0, 8);
const RUN_SEED = Number.parseInt(RUN_ID, 16);
const RUN_POINT = {
  lat: 55 + (RUN_SEED % 150) / 10,
  lng: -30 + ((RUN_SEED >> 8) % 200) / 10,
};
// Always >500km from RUN_POINT (and from each other), so the grid-cell and
// "other" fixtures never appear in the RUN_POINT radius assertions below,
// regardless of where RUN_POINT itself landed this run.
const GRID_POINT = { lat: RUN_POINT.lat - 10, lng: RUN_POINT.lng - 10 };
const OTHER_LAT = RUN_POINT.lat - 20;
const OTHER_LNG = RUN_POINT.lng - 20;
const KM_PER_DEGREE_LAT = 111.32;

function offsetLat(km: number): number {
  return RUN_POINT.lat + km / KM_PER_DEGREE_LAT;
}

// A fake IP dedicated to this suite's auth calls (sign-up, sign-in,
// verify-email): auth.integration.test.ts and products.integration.test.ts
// run auth flows too, from the default 127.0.0.1, and share the same Redis
// instance; without a distinct IP, clearing or hitting the per-IP auth rate
// limits here would race with theirs.
const AUTH_FAKE_IP = '10.50.1.1';
// Distinct from the default injected remote address (127.0.0.1), which
// uploads.integration.test.ts deliberately exhausts to test the uploads
// per-IP rate limit: sharing it would let this file's avatar/portfolio
// upload creations tip that limit over, failing uploadAndComplete() with
// "Failed to parse URL from undefined" when POST /v1/uploads 429s (issue #97).
const UPLOADS_FAKE_IP = '10.50.1.2';

async function clearRateLimitKeys(redis: Redis): Promise<void> {
  const patterns = [
    'rate-limit:profiles:*',
    'lockout:profiles:*',
    `rate-limit:auth:*:${AUTH_FAKE_IP}`,
    `lockout:auth:*:${AUTH_FAKE_IP}`,
    `rate-limit:uploads:*:${UPLOADS_FAKE_IP}`,
    `lockout:uploads:*:${UPLOADS_FAKE_IP}`,
  ];
  const all = (await Promise.all(patterns.map((pattern) => redis.keys(pattern)))).flat();
  if (all.length > 0) {
    await redis.del(...all);
  }
}

describe('profiles integration', () => {
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

  async function signUpAndSignIn(
    roles: readonly string[],
  ): Promise<{ token: string; id: string; email: string }> {
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
    return { token: body.session.token, id: body.user.id, email };
  }

  function authHeaders(token: string) {
    return { authorization: `Bearer ${token}` };
  }

  async function cleanupCreatedUsers(): Promise<void> {
    if (createdUserIds.length === 0) {
      return;
    }
    await prisma.photographerProfile.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.upload.deleteMany({ where: { ownerId: { in: createdUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    createdUserIds.length = 0;
  }

  function placeholderVariants(prefix: string): Record<string, string> {
    const variants: Record<string, string> = {};
    for (const name of ['thumb', 'medium', 'large']) {
      for (const [format, extension] of [
        ['jpeg', 'jpg'],
        ['webp', 'webp'],
      ] as const) {
        variants[`${name}_${format}`] = `v/${prefix}/${name}.${extension}`;
      }
    }
    return variants;
  }

  interface FixtureTierSpec {
    priceCents: number;
    currency?: string;
    isActive?: boolean;
  }

  interface FixtureProfileSpec {
    slug: string;
    displayName: string;
    city: string;
    lat: number;
    lng: number;
    categories: readonly (
      'wedding' | 'portrait' | 'event' | 'product' | 'real_estate' | 'corporate'
    )[];
    languages: readonly string[];
    ratingAvg?: number;
    ratingCount?: number;
    tier?: FixtureTierSpec;
    withApprovedPortfolioImage?: boolean;
  }

  async function createFixtureProfile(
    spec: FixtureProfileSpec,
  ): Promise<{ id: string; slug: string; userId: string }> {
    const user = await prisma.user.create({
      data: {
        email: `${spec.slug}@photoo.test`,
        emailVerifiedAt: new Date(),
        name: spec.displayName,
        locale: 'en',
        countryCode: 'LU',
        roles: ['photographer'],
        status: 'active',
      },
    });
    createdUserIds.push(user.id);

    const profile = await prisma.photographerProfile.create({
      data: {
        userId: user.id,
        slug: spec.slug,
        displayName: spec.displayName,
        bio: {},
        links: { other: [] },
        categories: [...spec.categories],
        languages: [...spec.languages],
        city: spec.city,
        countryCode: 'LU',
        verificationStatus: 'verified',
        stripeAccountId: `acct_fixture_${spec.slug}`,
        stripeOnboardingComplete: true,
        stripePayoutsEnabled: true,
        ratingAvg: spec.ratingAvg ?? 4.5,
        ratingCount: spec.ratingCount ?? 10,
        isPublished: true,
      },
    });

    await prisma.$executeRaw`
      UPDATE "PhotographerProfile"
      SET location = ST_SetSRID(ST_MakePoint(${spec.lng}, ${spec.lat}), 4326)::geography
      WHERE id = ${profile.id}
    `;

    if (spec.tier) {
      const product = await prisma.product.create({
        data: {
          profileId: profile.id,
          title: { en: `${spec.displayName} product` },
          category: spec.categories[0] ?? 'wedding',
          durationMinutes: 60,
          deliverables: { photos: 10, editedPhotos: 5, turnaroundDays: 5, onlineGallery: true },
          basePriceCents: spec.tier.priceCents,
          currency: spec.tier.currency ?? 'EUR',
          isActive: spec.tier.isActive ?? true,
          order: 1,
        },
      });
      await prisma.productTier.create({
        data: {
          productId: product.id,
          usage: 'commercial',
          priceCents: spec.tier.priceCents,
          currency: spec.tier.currency ?? 'EUR',
          description: 'Fixture tier',
          licenceTextVersion: 'v1',
        },
      });
    }

    if (spec.withApprovedPortfolioImage) {
      const variants = placeholderVariants(`fixtures/${spec.slug}/portfolio-1`);
      const upload = await prisma.upload.create({
        data: {
          ownerId: user.id,
          purpose: 'portfolio',
          status: 'processed',
          mimeType: 'image/jpeg',
          declaredSizeBytes: 8192,
          actualSizeBytes: 8192,
          width: 1600,
          height: 900,
          objectKey: `fixtures/${spec.slug}/portfolio-1/original.jpg`,
          variants,
          virusScanStatus: 'clean',
        },
      });
      await prisma.portfolioImage.create({
        data: {
          profileId: profile.id,
          uploadId: upload.id,
          width: 1600,
          height: 900,
          order: 1,
          status: 'approved',
        },
      });
    }

    return { id: profile.id, slug: spec.slug, userId: user.id };
  }

  const core = {
    slug: `fx-core-${RUN_ID}`,
    displayName: `Fx Core ${RUN_ID}`,
    city: `Fxborg ${RUN_ID}`,
  };
  const near = { slug: `fx-near-${RUN_ID}`, city: `Fxdalur ${RUN_ID}` };
  const far = { slug: `fx-far-${RUN_ID}`, city: `Fxheidi ${RUN_ID}` };
  const gridA = { slug: `fx-grid-a-${RUN_ID}`, city: `Fxnet ${RUN_ID}` };
  const gridB = { slug: `fx-grid-b-${RUN_ID}`, city: `Fxnet ${RUN_ID}` };
  const realEstate = { slug: `fx-realestate-${RUN_ID}`, city: `Fxvellir ${RUN_ID}` };
  const langPt = { slug: `fx-langpt-${RUN_ID}`, city: `Fxvik ${RUN_ID}` };
  const priceFixture = { slug: `fx-price-${RUN_ID}`, city: `Fxprice ${RUN_ID}` };
  const pageA = { slug: `fx-page-a-${RUN_ID}`, city: `Fxpaging ${RUN_ID}` };
  const pageB = { slug: `fx-page-b-${RUN_ID}`, city: `Fxpaging ${RUN_ID}` };

  // Fixture slugs always start with one of these literal prefixes (RUN_ID is
  // only ever appended as a suffix), so a run that got killed before its own
  // afterAll ran leaves rows a later run can find and remove by prefix alone,
  // before they can poison this run's radius/exact-list assertions (issue #97).
  const FIXTURE_SLUG_PREFIXES = [
    'fx-core-',
    'fx-near-',
    'fx-far-',
    'fx-grid-a-',
    'fx-grid-b-',
    'fx-realestate-',
    'fx-langpt-',
    'fx-price-',
    'fx-page-a-',
    'fx-page-b-',
  ];

  // Safe against a concurrent worktree run (not just a dead one): the prefix
  // alone would match its still-live fixtures on the same TEST_DATABASE_URL,
  // but no run of this file takes anywhere near 30 minutes.
  const ORPHAN_MAX_AGE_MS = 30 * 60 * 1000;

  async function cleanupOrphanedFixtures(): Promise<void> {
    const orphans = await prisma.photographerProfile.findMany({
      where: {
        OR: FIXTURE_SLUG_PREFIXES.map((prefix) => ({ slug: { startsWith: prefix } })),
        createdAt: { lt: new Date(Date.now() - ORPHAN_MAX_AGE_MS) },
      },
      select: { userId: true },
    });
    if (orphans.length === 0) {
      return;
    }
    const userIds = orphans.map((orphan) => orphan.userId);
    await prisma.photographerProfile.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.upload.deleteMany({ where: { ownerId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }

  beforeAll(async () => {
    app = await createTestApp({
      ...TEST_ENV,
      DATABASE_URL: testEnv.TEST_DATABASE_URL,
      REDIS_URL: testEnv.REDIS_URL,
    });
    prisma = createPrismaClient(testEnv.TEST_DATABASE_URL);
    redis = new Redis(testEnv.REDIS_URL);
    await clearRateLimitKeys(redis);
    await cleanupOrphanedFixtures();

    await createFixtureProfile({
      ...core,
      lat: RUN_POINT.lat,
      lng: RUN_POINT.lng,
      categories: ['wedding', 'portrait'],
      languages: ['en'],
      withApprovedPortfolioImage: true,
    });
    await createFixtureProfile({
      ...near,
      displayName: `Fx Near ${RUN_ID}`,
      lat: offsetLat(15),
      lng: RUN_POINT.lng,
      categories: ['wedding'],
      languages: ['en'],
    });
    await createFixtureProfile({
      ...far,
      displayName: `Fx Far ${RUN_ID}`,
      lat: offsetLat(40),
      lng: RUN_POINT.lng,
      categories: ['wedding'],
      languages: ['en'],
    });
    await createFixtureProfile({
      ...gridA,
      displayName: `Fx Grid A ${RUN_ID}`,
      lat: GRID_POINT.lat,
      lng: GRID_POINT.lng,
      categories: ['wedding'],
      languages: ['en'],
    });
    await createFixtureProfile({
      ...gridB,
      displayName: `Fx Grid B ${RUN_ID}`,
      lat: GRID_POINT.lat + 0.0002,
      lng: GRID_POINT.lng + 0.0002,
      categories: ['wedding'],
      languages: ['en'],
    });
    await createFixtureProfile({
      ...realEstate,
      displayName: `Fx Real Estate ${RUN_ID}`,
      lat: OTHER_LAT,
      lng: OTHER_LNG,
      categories: ['real_estate'],
      languages: ['en'],
    });
    await createFixtureProfile({
      ...langPt,
      displayName: `Fx Lang Pt ${RUN_ID}`,
      lat: OTHER_LAT,
      lng: OTHER_LNG,
      categories: ['wedding'],
      languages: ['pt'],
    });
    await createFixtureProfile({
      ...priceFixture,
      displayName: `Fx Price ${RUN_ID}`,
      lat: OTHER_LAT,
      lng: OTHER_LNG,
      categories: ['wedding'],
      languages: ['en'],
      tier: { priceCents: 1_500_000 },
    });
    await createFixtureProfile({
      ...pageA,
      displayName: `Fx Page A ${RUN_ID}`,
      lat: OTHER_LAT,
      lng: OTHER_LNG,
      categories: ['wedding'],
      languages: ['en'],
      ratingCount: 50,
    });
    await createFixtureProfile({
      ...pageB,
      displayName: `Fx Page B ${RUN_ID}`,
      lat: OTHER_LAT,
      lng: OTHER_LNG,
      categories: ['wedding'],
      languages: ['en'],
      ratingCount: 10,
    });
  });

  afterEach(async () => {
    await clearRateLimitKeys(redis);
  });

  afterAll(async () => {
    await cleanupCreatedUsers();
    await prisma.$disconnect();
    redis.disconnect();
    await app.close();
  });

  describe('GET /v1/photographers (search)', () => {
    it('returns only the fixture profile within a 10km radius of its own coordinates', async () => {
      const response = await fastify().inject({
        method: 'GET',
        url: `/v1/photographers?lat=${String(RUN_POINT.lat)}&lng=${String(RUN_POINT.lng)}&radiusKm=10`,
      });
      expect(response.statusCode).toBe(200);
      const body = response.json<PaginatedBody<SummaryBody>>();
      expect(body.items.map((item) => item.slug)).toEqual([core.slug]);
    });

    it('includes the 15km fixture but not the 40km fixture within a 20km radius', async () => {
      const response = await fastify().inject({
        method: 'GET',
        url: `/v1/photographers?lat=${String(RUN_POINT.lat)}&lng=${String(RUN_POINT.lng)}&radiusKm=20`,
      });
      const body = response.json<PaginatedBody<SummaryBody>>();
      expect(new Set(body.items.map((item) => item.slug))).toEqual(new Set([core.slug, near.slug]));
    });

    it('rejects a non-integer radiusKm with 400', async () => {
      const response = await fastify().inject({
        method: 'GET',
        url: `/v1/photographers?lat=${String(RUN_POINT.lat)}&lng=${String(RUN_POINT.lng)}&radiusKm=10.5`,
      });
      expect(response.statusCode).toBe(400);
    });

    it('rejects a radiusKm above 200 with 400', async () => {
      const response = await fastify().inject({
        method: 'GET',
        url: `/v1/photographers?lat=${String(RUN_POINT.lat)}&lng=${String(RUN_POINT.lng)}&radiusKm=201`,
      });
      expect(response.statusCode).toBe(400);
    });

    it('rounds the geo cursor distance to a whole kilometre', async () => {
      const response = await fastify().inject({
        method: 'GET',
        url: `/v1/photographers?lat=${String(GRID_POINT.lat)}&lng=${String(GRID_POINT.lng)}&radiusKm=5&limit=1`,
      });
      const body = response.json<PaginatedBody<SummaryBody>>();
      if (!body.nextCursor) {
        throw new Error('expected a nextCursor');
      }
      const decoded = decodeOpaqueCursor(body.nextCursor);
      expect(decoded.mode).toBe('distance');
      expect(Number.isInteger(decoded.value)).toBe(true);
    });

    it('keeps a stable relative order between two fixtures a few hundred metres apart in the same coarsening grid cell', async () => {
      const response = await fastify().inject({
        method: 'GET',
        url: `/v1/photographers?lat=${String(GRID_POINT.lat)}&lng=${String(GRID_POINT.lng)}&radiusKm=5&limit=20`,
      });
      const body = response.json<PaginatedBody<SummaryBody>>();
      const slugs = body.items.map((item) => item.slug);
      const gridAIndex = slugs.indexOf(gridA.slug);
      const gridBIndex = slugs.indexOf(gridB.slug);
      expect(gridAIndex).toBeGreaterThanOrEqual(0);
      expect(gridBIndex).toBeGreaterThanOrEqual(0);
      expect(gridAIndex).toBeLessThan(gridBIndex);
    });

    it('filters by category, scoped to this suite by the fixture city', async () => {
      const response = await fastify().inject({
        method: 'GET',
        url: `/v1/photographers?category=real-estate&city=${encodeURIComponent(realEstate.city)}`,
      });
      expect(response.statusCode).toBe(200);
      const body = response.json<PaginatedBody<SummaryBody>>();
      expect(body.items.map((item) => item.slug)).toEqual([realEstate.slug]);
      for (const item of body.items) {
        expect(item.categories).toContain('real-estate');
      }
    });

    it('filters by language, scoped to this suite by the fixture city', async () => {
      const response = await fastify().inject({
        method: 'GET',
        url: `/v1/photographers?language=pt&city=${encodeURIComponent(langPt.city)}`,
      });
      const body = response.json<PaginatedBody<SummaryBody>>();
      expect(body.items.map((item) => item.slug)).toEqual([langPt.slug]);
    });

    it('filters by price range against the lowest active tier price, scoped by the fixture city', async () => {
      const inRange = await fastify().inject({
        method: 'GET',
        url: `/v1/photographers?city=${encodeURIComponent(priceFixture.city)}&priceMinCents=1000000&priceMaxCents=2000000`,
      });
      expect(inRange.json<PaginatedBody<SummaryBody>>().items.map((item) => item.slug)).toEqual([
        priceFixture.slug,
      ]);

      const outOfRange = await fastify().inject({
        method: 'GET',
        url: `/v1/photographers?city=${encodeURIComponent(priceFixture.city)}&priceMinCents=1600000&priceMaxCents=2000000`,
      });
      expect(outOfRange.json<PaginatedBody<SummaryBody>>().items).toEqual([]);
    });

    it('paginates stably: two pages of size 1 return two distinct fixtures with no overlap', async () => {
      const first = await fastify().inject({
        method: 'GET',
        url: `/v1/photographers?city=${encodeURIComponent(pageA.city)}&limit=1`,
      });
      const firstBody = first.json<PaginatedBody<SummaryBody>>();
      expect(firstBody.items.map((item) => item.slug)).toEqual([pageA.slug]);
      expect(firstBody.nextCursor).not.toBeNull();

      const second = await fastify().inject({
        method: 'GET',
        url: `/v1/photographers?city=${encodeURIComponent(pageA.city)}&limit=1&cursor=${String(firstBody.nextCursor)}`,
      });
      const secondBody = second.json<PaginatedBody<SummaryBody>>();
      expect(secondBody.items.map((item) => item.slug)).toEqual([pageB.slug]);
      expect(secondBody.nextCursor).toBeNull();
    });

    it('treats a SQL injection attempt in city as literal data, not SQL', async () => {
      const response = await fastify().inject({
        method: 'GET',
        url: `/v1/photographers?${new URLSearchParams({ city: 'x\'; DROP TABLE "PhotographerProfile"; --' }).toString()}`,
      });
      expect(response.statusCode).toBe(200);
      expect(response.json<PaginatedBody<SummaryBody>>().items).toEqual([]);

      const stillThere = await fastify().inject({
        method: 'GET',
        url: `/v1/photographers/${core.slug}`,
      });
      expect(stillThere.statusCode).toBe(200);
    });

    it('treats city as an exact case-insensitive match, not a LIKE pattern: "%" matches nothing', async () => {
      const response = await fastify().inject({
        method: 'GET',
        url: `/v1/photographers?${new URLSearchParams({ city: '%' }).toString()}`,
      });
      expect(response.statusCode).toBe(200);
      expect(response.json<PaginatedBody<SummaryBody>>().items).toEqual([]);
    });

    it('matches city case-insensitively', async () => {
      const response = await fastify().inject({
        method: 'GET',
        url: `/v1/photographers?city=${encodeURIComponent(core.city.toUpperCase())}`,
      });
      expect(response.json<PaginatedBody<SummaryBody>>().items.map((item) => item.slug)).toEqual([
        core.slug,
      ]);
    });

    it('treats a malformed cursor as a 400, not a 500', async () => {
      const response = await fastify().inject({
        method: 'GET',
        url: '/v1/photographers?cursor=not-a-valid-cursor!!!',
      });
      expect(response.statusCode).toBe(400);
    });

    it('rejects an invalid cursor forged for the other sort mode', async () => {
      const geoResponse = await fastify().inject({
        method: 'GET',
        url: `/v1/photographers?city=${encodeURIComponent(pageA.city)}&limit=1`,
      });
      const cursor = geoResponse.json<PaginatedBody<SummaryBody>>().nextCursor;
      if (cursor) {
        const replay = await fastify().inject({
          method: 'GET',
          url: `/v1/photographers?lat=${String(RUN_POINT.lat)}&lng=${String(RUN_POINT.lng)}&cursor=${cursor}`,
        });
        expect(replay.statusCode).toBe(400);
      }
    });
  });

  describe('GET /v1/photographers/:slug', () => {
    it('returns the published fixture profile with approved portfolio and no coordinates', async () => {
      const response = await fastify().inject({
        method: 'GET',
        url: `/v1/photographers/${core.slug}`,
      });
      expect(response.statusCode).toBe(200);
      const body = response.json<Record<string, unknown>>();
      expect(body.location).toBeUndefined();
      expect(Array.isArray(body.portfolio)).toBe(true);
      expect((body.portfolio as unknown[]).length).toBeGreaterThan(0);
    });

    it('returns 404 for a missing slug', async () => {
      const response = await fastify().inject({
        method: 'GET',
        url: '/v1/photographers/does-not-exist-at-all',
      });
      expect(response.statusCode).toBe(404);
    });

    it('never carries the account name behind the profile, only the chosen displayName', async () => {
      const photographer = await signUpAndSignIn(['photographer']);
      const accountNameFragment = photographer.email.split('@')[0] ?? '';

      const createResponse = await fastify().inject({
        method: 'POST',
        url: '/v1/me/photographer-profile',
        headers: authHeaders(photographer.token),
        payload: {
          displayName: `Fx Name Leak ${RUN_ID}`,
          categories: ['wedding'],
          languages: ['en'],
          location: { lat: 49.6, lng: 6.1 },
          city: 'Luxembourg',
          countryCode: 'LU',
        },
      });
      const created = createResponse.json<OwnProfileBody>();
      await prisma.photographerProfile.update({
        where: { id: created.id },
        data: { isPublished: true },
      });

      const response = await fastify().inject({
        method: 'GET',
        url: `/v1/photographers/${created.slug}`,
      });
      expect(response.statusCode).toBe(200);
      expect(response.body).not.toContain(accountNameFragment);
      expect(response.json<Record<string, unknown>>()).not.toHaveProperty('name');
    });
  });

  describe('POST /v1/me/photographer-profile', () => {
    it('rejects a user without the photographer role with 403', async () => {
      const client = await signUpAndSignIn(['client']);
      const response = await fastify().inject({
        method: 'POST',
        url: '/v1/me/photographer-profile',
        headers: authHeaders(client.token),
        payload: {
          displayName: 'Client Trying Anyway',
          categories: ['wedding'],
          languages: ['en'],
          location: { lat: 49.6116, lng: 6.1319 },
          city: 'Luxembourg',
          countryCode: 'LU',
        },
      });
      expect(response.statusCode).toBe(403);
    });

    it('rejects an unauthenticated request with 401', async () => {
      const response = await fastify().inject({
        method: 'POST',
        url: '/v1/me/photographer-profile',
        payload: {
          displayName: 'Nobody',
          categories: ['wedding'],
          languages: ['en'],
          location: { lat: 49.6116, lng: 6.1319 },
          city: 'Luxembourg',
          countryCode: 'LU',
        },
      });
      expect(response.statusCode).toBe(401);
    });

    it('creates a profile, generating a slug collision suffix against a fixture profile', async () => {
      const photographer = await signUpAndSignIn(['photographer']);
      const response = await fastify().inject({
        method: 'POST',
        url: '/v1/me/photographer-profile',
        headers: authHeaders(photographer.token),
        payload: {
          displayName: core.displayName,
          categories: ['wedding'],
          languages: ['en'],
          location: { lat: 49.6, lng: 6.1 },
          city: 'Luxembourg',
          countryCode: 'LU',
        },
      });
      expect(response.statusCode).toBe(201);
      const body = response.json<OwnProfileBody>();
      expect(body.slug).toBe(`${core.slug}-2`);
      expect(body.isPublished).toBe(false);

      const conflict = await fastify().inject({
        method: 'POST',
        url: '/v1/me/photographer-profile',
        headers: authHeaders(photographer.token),
        payload: {
          displayName: `${core.displayName} Again`,
          categories: ['wedding'],
          languages: ['en'],
          location: { lat: 49.6, lng: 6.1 },
          city: 'Luxembourg',
          countryCode: 'LU',
        },
      });
      expect(conflict.statusCode).toBe(409);
    });

    it('generates a reserved-word-safe slug', async () => {
      const photographer = await signUpAndSignIn(['photographer']);
      const response = await fastify().inject({
        method: 'POST',
        url: '/v1/me/photographer-profile',
        headers: authHeaders(photographer.token),
        payload: {
          displayName: 'Admin',
          categories: ['wedding'],
          languages: ['en'],
          location: { lat: 49.6, lng: 6.1 },
          city: 'Luxembourg',
          countryCode: 'LU',
        },
      });
      expect(response.statusCode).toBe(201);
      expect(response.json<OwnProfileBody>().slug).not.toBe('admin');
    });

    it('rejects a disabled or unknown countryCode with 422', async () => {
      const photographer = await signUpAndSignIn(['photographer']);
      const response = await fastify().inject({
        method: 'POST',
        url: '/v1/me/photographer-profile',
        headers: authHeaders(photographer.token),
        payload: {
          displayName: 'Nowhere Photography',
          categories: ['wedding'],
          languages: ['en'],
          location: { lat: 49.6, lng: 6.1 },
          city: 'Nowhere',
          countryCode: 'ZZ',
        },
      });
      expect(response.statusCode).toBe(422);
    });

    it('rejects a javascript: URL in links.website with 400', async () => {
      const photographer = await signUpAndSignIn(['photographer']);
      const response = await fastify().inject({
        method: 'POST',
        url: '/v1/me/photographer-profile',
        headers: authHeaders(photographer.token),
        payload: {
          displayName: 'Link Test Photography',
          categories: ['wedding'],
          languages: ['en'],
          location: { lat: 49.6, lng: 6.1 },
          city: 'Luxembourg',
          countryCode: 'LU',
          links: { website: 'javascript:alert(1)', other: [] },
        },
      });
      expect(response.statusCode).toBe(400);
    });
  });

  describe('avatar/cover upload validation on PATCH /v1/me/photographer-profile', () => {
    async function createOwnProfile(token: string, suffix: string) {
      const response = await fastify().inject({
        method: 'POST',
        url: '/v1/me/photographer-profile',
        headers: authHeaders(token),
        payload: {
          displayName: `Upload Test ${suffix}`,
          categories: ['wedding'],
          languages: ['en'],
          location: { lat: 49.6, lng: 6.1 },
          city: 'Luxembourg',
          countryCode: 'LU',
        },
      });
      return response.json<OwnProfileBody>();
    }

    async function createUpload(token: string, purpose: string) {
      const response = await fastify().inject({
        method: 'POST',
        url: '/v1/uploads',
        remoteAddress: UPLOADS_FAKE_IP,
        headers: authHeaders(token),
        payload: { purpose, mimeType: 'image/jpeg', sizeBytes: 1024 },
      });
      return response.json<{ uploadId: string; url: string; headers: Record<string, string> }>();
    }

    async function uploadAndComplete(token: string, purpose: string): Promise<string> {
      const created = await createUpload(token, purpose);
      const buffer = Buffer.alloc(1024, 3);
      await fetch(created.url, { method: 'PUT', body: buffer, headers: created.headers });
      await fastify().inject({
        method: 'POST',
        url: `/v1/uploads/${created.uploadId}/complete`,
        headers: authHeaders(token),
      });
      return created.uploadId;
    }

    // The api integration suite never runs the worker's virus-scan job
    // (apps/worker is a separate process, not started here), so an upload
    // never reaches "clean" on its own; this simulates the scan finishing,
    // the same way `withApprovedPortfolioImage` simulates the worker having
    // already run for fixture profiles created directly via Prisma.
    async function markScanClean(uploadId: string): Promise<void> {
      await prisma.upload.update({
        where: { id: uploadId },
        data: { status: 'clean', virusScanStatus: 'clean' },
      });
    }

    it('rejects an avatarUploadId not owned by the caller with 404', async () => {
      const owner = await signUpAndSignIn(['photographer']);
      await createOwnProfile(owner.token, 'avatar-not-owned');
      const otherUser = await signUpAndSignIn(['photographer']);

      const otherUpload = await fastify().inject({
        method: 'POST',
        url: '/v1/uploads',
        remoteAddress: UPLOADS_FAKE_IP,
        headers: authHeaders(otherUser.token),
        payload: { purpose: 'avatar', mimeType: 'image/jpeg', sizeBytes: 1024 },
      });
      const otherUploadId = otherUpload.json<{ uploadId: string }>().uploadId;

      const response = await fastify().inject({
        method: 'PATCH',
        url: '/v1/me/photographer-profile',
        headers: authHeaders(owner.token),
        payload: { avatarUploadId: otherUploadId },
      });
      expect(response.statusCode).toBe(404);
    });

    it('rejects an avatarUploadId whose purpose is not "avatar" with 422', async () => {
      const owner = await signUpAndSignIn(['photographer']);
      await createOwnProfile(owner.token, 'avatar-wrong-purpose');

      const coverUpload = await fastify().inject({
        method: 'POST',
        url: '/v1/uploads',
        remoteAddress: UPLOADS_FAKE_IP,
        headers: authHeaders(owner.token),
        payload: { purpose: 'cover', mimeType: 'image/jpeg', sizeBytes: 1024 },
      });
      const coverUploadId = coverUpload.json<{ uploadId: string }>().uploadId;

      const response = await fastify().inject({
        method: 'PATCH',
        url: '/v1/me/photographer-profile',
        headers: authHeaders(owner.token),
        payload: { avatarUploadId: coverUploadId },
      });
      expect(response.statusCode).toBe(422);
    });

    it('rejects an avatarUploadId still awaiting virus scan (status "uploaded") with 422', async () => {
      const owner = await signUpAndSignIn(['photographer']);
      await createOwnProfile(owner.token, 'avatar-not-scanned');
      const uploadId = await uploadAndComplete(owner.token, 'avatar');

      const response = await fastify().inject({
        method: 'PATCH',
        url: '/v1/me/photographer-profile',
        headers: authHeaders(owner.token),
        payload: { avatarUploadId: uploadId },
      });
      expect(response.statusCode).toBe(422);
    });

    it('accepts clearing the avatar with null', async () => {
      const owner = await signUpAndSignIn(['photographer']);
      await createOwnProfile(owner.token, 'avatar-clear');

      const response = await fastify().inject({
        method: 'PATCH',
        url: '/v1/me/photographer-profile',
        headers: authHeaders(owner.token),
        payload: { avatarUploadId: null },
      });
      expect(response.statusCode).toBe(200);
    });

    it('only exposes avatarUrl once the upload has finished processing', async () => {
      const owner = await signUpAndSignIn(['photographer']);
      await createOwnProfile(owner.token, 'avatar-processed-only');
      const uploadId = await uploadAndComplete(owner.token, 'avatar');
      await markScanClean(uploadId);

      const attach = await fastify().inject({
        method: 'PATCH',
        url: '/v1/me/photographer-profile',
        headers: authHeaders(owner.token),
        payload: { avatarUploadId: uploadId },
      });
      expect(attach.statusCode).toBe(200);
      expect(attach.json<OwnProfileBody>().avatarUrl).toBeNull();

      const variants = placeholderVariants(`test/avatar-processed/${uploadId}`);
      await prisma.upload.update({
        where: { id: uploadId },
        data: { status: 'processed', variants, width: 512, height: 512 },
      });

      const afterProcessing = await fastify().inject({
        method: 'GET',
        url: '/v1/me/photographer-profile',
        headers: authHeaders(owner.token),
      });
      expect(afterProcessing.json<OwnProfileBody>().avatarUrl).not.toBeNull();
    });
  });

  describe('portfolio', () => {
    async function createOwnProfile(token: string, suffix: string) {
      const response = await fastify().inject({
        method: 'POST',
        url: '/v1/me/photographer-profile',
        headers: authHeaders(token),
        payload: {
          displayName: `Portfolio Test ${suffix}`,
          categories: ['wedding'],
          languages: ['en'],
          location: { lat: 49.6, lng: 6.1 },
          city: 'Luxembourg',
          countryCode: 'LU',
        },
      });
      return response.json<OwnProfileBody>();
    }

    async function createUpload(token: string, purpose: string) {
      const response = await fastify().inject({
        method: 'POST',
        url: '/v1/uploads',
        remoteAddress: UPLOADS_FAKE_IP,
        headers: authHeaders(token),
        payload: { purpose, mimeType: 'image/jpeg', sizeBytes: 1024 },
      });
      return response.json<{ uploadId: string; url: string; headers: Record<string, string> }>();
    }

    async function uploadAndComplete(token: string, purpose: string) {
      const created = await createUpload(token, purpose);
      const buffer = Buffer.alloc(1024, 3);
      await fetch(created.url, { method: 'PUT', body: buffer, headers: created.headers });
      await fastify().inject({
        method: 'POST',
        url: `/v1/uploads/${created.uploadId}/complete`,
        headers: authHeaders(token),
      });
      return created.uploadId;
    }

    // See the identically-named helper above: this suite never runs the
    // worker's virus-scan job, so a freshly uploaded file is simulated as
    // scanned clean before it can be attached.
    async function markScanClean(uploadId: string): Promise<void> {
      await prisma.upload.update({
        where: { id: uploadId },
        data: { status: 'clean', virusScanStatus: 'clean' },
      });
    }

    async function uploadScannedAndComplete(token: string, purpose: string): Promise<string> {
      const uploadId = await uploadAndComplete(token, purpose);
      await markScanClean(uploadId);
      return uploadId;
    }

    it('rejects attaching an upload with the wrong purpose with 422', async () => {
      const owner = await signUpAndSignIn(['photographer']);
      await createOwnProfile(owner.token, 'attach-wrong-purpose');
      const uploadId = await uploadScannedAndComplete(owner.token, 'avatar');

      const response = await fastify().inject({
        method: 'POST',
        url: '/v1/me/photographer-profile/portfolio',
        headers: authHeaders(owner.token),
        payload: { uploadId },
      });
      expect(response.statusCode).toBe(422);
    });

    it('rejects attaching an upload not owned by the caller with 404', async () => {
      const owner = await signUpAndSignIn(['photographer']);
      await createOwnProfile(owner.token, 'attach-not-owned');
      const other = await signUpAndSignIn(['photographer']);
      const uploadId = await uploadScannedAndComplete(other.token, 'portfolio');

      const response = await fastify().inject({
        method: 'POST',
        url: '/v1/me/photographer-profile/portfolio',
        headers: authHeaders(owner.token),
        payload: { uploadId },
      });
      expect(response.statusCode).toBe(404);
    });

    it('rejects attaching an upload still awaiting virus scan (status "uploaded") with 422', async () => {
      const owner = await signUpAndSignIn(['photographer']);
      await createOwnProfile(owner.token, 'attach-not-scanned');
      const uploadId = await uploadAndComplete(owner.token, 'portfolio');

      const response = await fastify().inject({
        method: 'POST',
        url: '/v1/me/photographer-profile/portfolio',
        headers: authHeaders(owner.token),
        payload: { uploadId },
      });
      expect(response.statusCode).toBe(422);
    });

    it('attaches, lists, reorders and deletes portfolio images', async () => {
      const owner = await signUpAndSignIn(['photographer']);
      await createOwnProfile(owner.token, 'lifecycle');

      const uploadIdA = await uploadScannedAndComplete(owner.token, 'portfolio');
      const uploadIdB = await uploadScannedAndComplete(owner.token, 'portfolio');

      const attachA = await fastify().inject({
        method: 'POST',
        url: '/v1/me/photographer-profile/portfolio',
        headers: authHeaders(owner.token),
        payload: { uploadId: uploadIdA },
      });
      expect(attachA.statusCode).toBe(201);
      const imageA = attachA.json<PortfolioImageBody>();
      expect(imageA.status).toBe('processing');
      expect(imageA.url).toBeNull();
      expect(imageA.width).toBeNull();

      const duplicateAttach = await fastify().inject({
        method: 'POST',
        url: '/v1/me/photographer-profile/portfolio',
        headers: authHeaders(owner.token),
        payload: { uploadId: uploadIdA },
      });
      expect(duplicateAttach.statusCode).toBe(409);

      const attachB = await fastify().inject({
        method: 'POST',
        url: '/v1/me/photographer-profile/portfolio',
        headers: authHeaders(owner.token),
        payload: { uploadId: uploadIdB },
      });
      expect(attachB.statusCode).toBe(201);
      const imageB = attachB.json<PortfolioImageBody>();

      const list = await fastify().inject({
        method: 'GET',
        url: '/v1/me/photographer-profile/portfolio',
        headers: authHeaders(owner.token),
      });
      expect(list.statusCode).toBe(200);
      const listBody = list.json<PaginatedBody<PortfolioImageBody>>();
      expect(listBody.items.map((item) => item.id).sort()).toEqual([imageA.id, imageB.id].sort());

      const badReorder = await fastify().inject({
        method: 'PATCH',
        url: '/v1/me/photographer-profile/portfolio/order',
        headers: authHeaders(owner.token),
        payload: { imageIds: [imageA.id] },
      });
      expect(badReorder.statusCode).toBe(422);

      const reorder = await fastify().inject({
        method: 'PATCH',
        url: '/v1/me/photographer-profile/portfolio/order',
        headers: authHeaders(owner.token),
        payload: { imageIds: [imageB.id, imageA.id] },
      });
      expect(reorder.statusCode).toBe(200);
      const reorderBody = reorder.json<PaginatedBody<PortfolioImageBody>>();
      expect(reorderBody.items.map((item) => item.id)).toEqual([imageB.id, imageA.id]);

      const deleteResponse = await fastify().inject({
        method: 'DELETE',
        url: `/v1/me/photographer-profile/portfolio/${imageA.id}`,
        headers: authHeaders(owner.token),
      });
      expect(deleteResponse.statusCode).toBe(204);

      const listAfterDelete = await fastify().inject({
        method: 'GET',
        url: '/v1/me/photographer-profile/portfolio',
        headers: authHeaders(owner.token),
      });
      const afterDeleteBody = listAfterDelete.json<PaginatedBody<PortfolioImageBody>>();
      expect(afterDeleteBody.items.map((item) => item.id)).toEqual([imageB.id]);

      const deleteAgain = await fastify().inject({
        method: 'DELETE',
        url: `/v1/me/photographer-profile/portfolio/${imageA.id}`,
        headers: authHeaders(owner.token),
      });
      expect(deleteAgain.statusCode).toBe(404);
    });

    it('rejects a non-owner from deleting a portfolio image with 404, indistinguishable from a missing one', async () => {
      const owner = await signUpAndSignIn(['photographer']);
      await createOwnProfile(owner.token, 'delete-forbidden');
      const uploadId = await uploadScannedAndComplete(owner.token, 'portfolio');
      const attach = await fastify().inject({
        method: 'POST',
        url: '/v1/me/photographer-profile/portfolio',
        headers: authHeaders(owner.token),
        payload: { uploadId },
      });
      const image = attach.json<PortfolioImageBody>();

      const other = await signUpAndSignIn(['photographer']);
      await createOwnProfile(other.token, 'delete-forbidden-other');

      const response = await fastify().inject({
        method: 'DELETE',
        url: `/v1/me/photographer-profile/portfolio/${image.id}`,
        headers: authHeaders(other.token),
      });
      expect(response.statusCode).toBe(404);
    });
  });
});
