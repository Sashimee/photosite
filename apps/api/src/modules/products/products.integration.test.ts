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

interface ProductBody {
  id: string;
  isActive: boolean;
  tiers: { id: string; usage: string }[];
}

function uniqueEmail(label: string): string {
  return `products-${label}-${randomUUID()}@photoo.test`;
}

// Kept far from the profiles suite's own remote fixture cluster
// (apps/api/src/modules/profiles/profiles.integration.test.ts) so neither
// suite's published/verified fixtures can be picked up by the other's
// queries when both run concurrently against the same database.
const FIXTURE_RUN_ID = randomUUID().replaceAll('-', '').slice(0, 8);
const FIXTURE_LAT = -33.8688;
const FIXTURE_LNG = 151.2093;

const validTier = {
  usage: 'personal',
  price: { amountCents: 15000, currency: 'EUR' },
  description: 'For personal use',
  licenceTextVersion: 'v1',
};

const validCreatePayload = {
  title: { en: 'Portrait session' },
  category: 'portrait',
  durationMinutes: 60,
  deliverables: { photos: 20, editedPhotos: 20, turnaroundDays: 7, onlineGallery: true },
  basePrice: { amountCents: 15000, currency: 'EUR' },
  tiers: [validTier],
};

// A fake IP dedicated to this suite's auth calls: auth.integration.test.ts
// and profiles.integration.test.ts run auth flows too, from a different IP
// each, sharing the same Redis instance; without a distinct IP, clearing or
// hitting the per-IP auth rate limits here would race with theirs.
const AUTH_FAKE_IP = '10.50.2.1';

async function clearRateLimitKeys(redis: Redis): Promise<void> {
  const patterns = [
    'rate-limit:profiles:*',
    'lockout:profiles:*',
    `rate-limit:auth:*:${AUTH_FAKE_IP}`,
    `lockout:auth:*:${AUTH_FAKE_IP}`,
  ];
  const all = (await Promise.all(patterns.map((pattern) => redis.keys(pattern)))).flat();
  if (all.length > 0) {
    await redis.del(...all);
  }
}

describe('products integration', () => {
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

  async function createPhotographerWithProfile(suffix: string) {
    const user = await signUpAndSignIn(['photographer']);
    await fastify().inject({
      method: 'POST',
      url: '/v1/me/photographer-profile',
      headers: authHeaders(user.token),
      payload: {
        displayName: `Products Test ${suffix}`,
        categories: ['portrait'],
        languages: ['en'],
        location: { lat: 49.6, lng: 6.1 },
        city: 'Luxembourg',
        countryCode: 'LU',
      },
    });
    return user;
  }

  const publishedFixtureSlug = `fx-products-${FIXTURE_RUN_ID}`;

  async function createPublishedFixtureProfile(): Promise<void> {
    const user = await prisma.user.create({
      data: {
        email: `${publishedFixtureSlug}@photoo.test`,
        emailVerifiedAt: new Date(),
        name: `Fx Products ${FIXTURE_RUN_ID}`,
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
        slug: publishedFixtureSlug,
        displayName: `Fx Products ${FIXTURE_RUN_ID}`,
        bio: {},
        links: { other: [] },
        categories: ['portrait'],
        languages: ['en'],
        city: `Fx Products City ${FIXTURE_RUN_ID}`,
        countryCode: 'LU',
        verificationStatus: 'verified',
        stripeAccountId: `acct_fixture_${publishedFixtureSlug}`,
        stripeOnboardingComplete: true,
        stripePayoutsEnabled: true,
        isPublished: true,
      },
    });
    await prisma.$executeRaw`
      UPDATE "PhotographerProfile"
      SET location = ST_SetSRID(ST_MakePoint(${FIXTURE_LNG}, ${FIXTURE_LAT}), 4326)::geography
      WHERE id = ${profile.id}
    `;

    const product = await prisma.product.create({
      data: {
        profileId: profile.id,
        title: { en: 'Fixture portrait session' },
        category: 'portrait',
        durationMinutes: 60,
        deliverables: { photos: 20, editedPhotos: 20, turnaroundDays: 7, onlineGallery: true },
        basePriceCents: 15000,
        currency: 'EUR',
        isActive: true,
        order: 1,
      },
    });
    await prisma.productTier.create({
      data: {
        productId: product.id,
        usage: 'personal',
        priceCents: 15000,
        currency: 'EUR',
        description: 'Fixture tier',
        licenceTextVersion: 'v1',
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
    await clearRateLimitKeys(redis);
    await createPublishedFixtureProfile();
  });

  afterEach(async () => {
    await clearRateLimitKeys(redis);
  });

  afterAll(async () => {
    if (createdUserIds.length > 0) {
      await prisma.photographerProfile.deleteMany({ where: { userId: { in: createdUserIds } } });
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    await prisma.$disconnect();
    redis.disconnect();
    await app.close();
  });

  it('rejects a client role with 403 on create', async () => {
    const client = await signUpAndSignIn(['client']);
    const response = await fastify().inject({
      method: 'POST',
      url: '/v1/me/products',
      headers: authHeaders(client.token),
      payload: validCreatePayload,
    });
    expect(response.statusCode).toBe(403);
  });

  it('returns 404 for a photographer without a profile yet', async () => {
    const photographer = await signUpAndSignIn(['photographer']);
    const response = await fastify().inject({
      method: 'GET',
      url: '/v1/me/products',
      headers: authHeaders(photographer.token),
    });
    expect(response.statusCode).toBe(404);
  });

  it('rejects duplicate tier usage values with 422', async () => {
    const owner = await createPhotographerWithProfile('duplicate-tier');
    const response = await fastify().inject({
      method: 'POST',
      url: '/v1/me/products',
      headers: authHeaders(owner.token),
      payload: { ...validCreatePayload, tiers: [validTier, validTier] },
    });
    expect(response.statusCode).toBe(422);
  });

  it('rejects a basePrice currency that does not match the profile country currency', async () => {
    const owner = await createPhotographerWithProfile('bad-currency');
    const response = await fastify().inject({
      method: 'POST',
      url: '/v1/me/products',
      headers: authHeaders(owner.token),
      payload: {
        ...validCreatePayload,
        basePrice: { amountCents: 15000, currency: 'USD' },
      },
    });
    expect(response.statusCode).toBe(422);
  });

  it('creates, reads, updates (replacing tiers as a set), and soft-deletes a product', async () => {
    const owner = await createPhotographerWithProfile('lifecycle');

    const createResponse = await fastify().inject({
      method: 'POST',
      url: '/v1/me/products',
      headers: authHeaders(owner.token),
      payload: validCreatePayload,
    });
    expect(createResponse.statusCode).toBe(201);
    const created = createResponse.json<ProductBody>();
    expect(created.tiers).toHaveLength(1);

    const getResponse = await fastify().inject({
      method: 'GET',
      url: `/v1/me/products/${created.id}`,
      headers: authHeaders(owner.token),
    });
    expect(getResponse.statusCode).toBe(200);

    const updateResponse = await fastify().inject({
      method: 'PATCH',
      url: `/v1/me/products/${created.id}`,
      headers: authHeaders(owner.token),
      payload: {
        tiers: [
          { ...validTier, usage: 'commercial', price: { amountCents: 30000, currency: 'EUR' } },
        ],
      },
    });
    expect(updateResponse.statusCode).toBe(200);
    const updated = updateResponse.json<ProductBody>();
    expect(updated.tiers).toHaveLength(1);
    expect(updated.tiers[0]?.usage).toBe('commercial');

    const deleteResponse = await fastify().inject({
      method: 'DELETE',
      url: `/v1/me/products/${created.id}`,
      headers: authHeaders(owner.token),
    });
    expect(deleteResponse.statusCode).toBe(204);

    const getAfterDelete = await fastify().inject({
      method: 'GET',
      url: `/v1/me/products/${created.id}`,
      headers: authHeaders(owner.token),
    });
    expect(getAfterDelete.statusCode).toBe(404);
  });

  it('rejects a non-owner from reading another photographer product with 404, indistinguishable from a missing one', async () => {
    const owner = await createPhotographerWithProfile('forbidden-owner');
    const createResponse = await fastify().inject({
      method: 'POST',
      url: '/v1/me/products',
      headers: authHeaders(owner.token),
      payload: validCreatePayload,
    });
    const created = createResponse.json<ProductBody>();

    const other = await createPhotographerWithProfile('forbidden-other');
    const response = await fastify().inject({
      method: 'GET',
      url: `/v1/me/products/${created.id}`,
      headers: authHeaders(other.token),
    });
    expect(response.statusCode).toBe(404);
  });

  it('returns 404 for a missing product id', async () => {
    const owner = await createPhotographerWithProfile('missing-product');
    const response = await fastify().inject({
      method: 'GET',
      url: '/v1/me/products/00000000-0000-4000-8000-000000000000',
      headers: authHeaders(owner.token),
    });
    expect(response.statusCode).toBe(404);
  });

  it('lists the fixture published photographer active products publicly', async () => {
    const response = await fastify().inject({
      method: 'GET',
      url: `/v1/photographers/${publishedFixtureSlug}/products`,
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<ProductBody[]>();
    expect(body.length).toBeGreaterThan(0);
  });

  it('returns 404 for the public product list of an unpublished profile', async () => {
    const owner = await createPhotographerWithProfile('unpublished-products');
    await fastify().inject({
      method: 'POST',
      url: '/v1/me/products',
      headers: authHeaders(owner.token),
      payload: validCreatePayload,
    });

    const profileResponse = await fastify().inject({
      method: 'GET',
      url: '/v1/me/photographer-profile',
      headers: authHeaders(owner.token),
    });
    const slug = profileResponse.json<{ slug: string }>().slug;

    const response = await fastify().inject({
      method: 'GET',
      url: `/v1/photographers/${slug}/products`,
    });
    expect(response.statusCode).toBe(404);
  });
});
