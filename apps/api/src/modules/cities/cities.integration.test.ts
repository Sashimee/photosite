import { randomUUID } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createPrismaClient, type PrismaClient } from '@photoo/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../../testing/create-test-app.js';
import { requireIntegrationEnv } from '../../testing/require-integration-env.js';
import { TEST_ENV } from '../../testing/test-env.js';

const testEnv = requireIntegrationEnv(['TEST_DATABASE_URL', 'REDIS_URL']);

const RUN_ID = randomUUID().replaceAll('-', '').slice(0, 8);
// Query-only: never written to a fixture, so it never needs its own Country
// row (the seeded Country table only has LU, and adding rows to it here
// would race the packages/db seed idempotency test under parallel `turbo
// run test`, see docs/steps/1B.4-discovery.md).
const NO_FIXTURE_COUNTRY_CODE = 'ZZ';

interface CityBody {
  slug: string;
  name: string;
  countryCode: string;
  photographerCount: number;
  location: { lat: number; lng: number };
}

function uniqueEmail(label: string): string {
  return `cities-${label}-${RUN_ID}@photoo.test`;
}

describe('cities integration', () => {
  if (!testEnv) {
    it.skip('skipped: TEST_DATABASE_URL or REDIS_URL is not set', () => undefined);
    return;
  }

  let app: NestFastifyApplication;
  let prisma: PrismaClient;
  const createdUserIds: string[] = [];

  function fastify() {
    return app.getHttpAdapter().getInstance();
  }

  async function createFixtureProfile(spec: {
    label: string;
    city: string;
    countryCode: string;
    isPublished: boolean;
    location?: { lat: number; lng: number };
    deleted?: boolean;
  }): Promise<void> {
    const user = await prisma.user.create({
      data: {
        email: uniqueEmail(spec.label),
        emailVerifiedAt: new Date(),
        name: `Fx ${spec.label}`,
        locale: 'en',
        countryCode: spec.countryCode,
        roles: ['photographer'],
        status: 'active',
      },
    });
    createdUserIds.push(user.id);

    const profile = await prisma.photographerProfile.create({
      data: {
        userId: user.id,
        slug: `fx-cities-${spec.label}-${RUN_ID}`,
        displayName: `Fx ${spec.label}`,
        bio: {},
        links: { other: [] },
        categories: ['wedding'],
        languages: ['en'],
        city: spec.city,
        countryCode: spec.countryCode,
        isPublished: spec.isPublished,
        deletedAt: spec.deleted === true ? new Date() : null,
      },
    });

    const location = spec.location ?? { lat: 49.61, lng: 6.13 };
    await prisma.$executeRaw`
      UPDATE "PhotographerProfile"
      SET location = ST_SetSRID(ST_MakePoint(${location.lng}, ${location.lat}), 4326)::geography
      WHERE id = ${profile.id}
    `;
  }

  async function cleanup(): Promise<void> {
    if (createdUserIds.length === 0) {
      return;
    }
    await prisma.photographerProfile.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    createdUserIds.length = 0;
  }

  const publishedCity = `Fxcitypublished-${RUN_ID}`;
  const mixedCity = `Fxcitymixed-${RUN_ID}`;
  const accentedCity = `Fxcityépinal-${RUN_ID}`;
  const countryFilterCity = `Fxcitybordeaux-${RUN_ID}`;
  const busyCity = `Fxcitybusy-${RUN_ID}`;
  const quietCity = `Fxcityquiet-${RUN_ID}`;
  const limitA = `Fxcitylimit-a-${RUN_ID}`;
  const limitB = `Fxcitylimit-b-${RUN_ID}`;
  const limitC = `Fxcitylimit-c-${RUN_ID}`;
  const centroidCity = `Fxcitycentroid-${RUN_ID}`;
  const excludedCity = `Fxcityexcluded-${RUN_ID}`;

  beforeAll(async () => {
    app = await createTestApp({
      ...TEST_ENV,
      DATABASE_URL: testEnv.TEST_DATABASE_URL,
      REDIS_URL: testEnv.REDIS_URL,
    });
    prisma = createPrismaClient(testEnv.TEST_DATABASE_URL);

    await createFixtureProfile({
      label: 'published',
      city: publishedCity,
      countryCode: 'LU',
      isPublished: true,
    });
    await createFixtureProfile({
      label: 'mixed-published',
      city: mixedCity,
      countryCode: 'LU',
      isPublished: true,
    });
    await createFixtureProfile({
      label: 'mixed-unpublished',
      city: mixedCity,
      countryCode: 'LU',
      isPublished: false,
    });
    await createFixtureProfile({
      label: 'accented',
      city: accentedCity,
      countryCode: 'LU',
      isPublished: true,
    });
    await createFixtureProfile({
      label: 'country-filter',
      city: countryFilterCity,
      countryCode: 'LU',
      isPublished: true,
    });
    await createFixtureProfile({
      label: 'busy-1',
      city: busyCity,
      countryCode: 'LU',
      isPublished: true,
    });
    await createFixtureProfile({
      label: 'busy-2',
      city: busyCity,
      countryCode: 'LU',
      isPublished: true,
    });
    await createFixtureProfile({
      label: 'quiet',
      city: quietCity,
      countryCode: 'LU',
      isPublished: true,
    });
    await createFixtureProfile({
      label: 'limit-a',
      city: limitA,
      countryCode: 'LU',
      isPublished: true,
    });
    await createFixtureProfile({
      label: 'limit-b',
      city: limitB,
      countryCode: 'LU',
      isPublished: true,
    });
    await createFixtureProfile({
      label: 'limit-c',
      city: limitC,
      countryCode: 'LU',
      isPublished: true,
    });
    await createFixtureProfile({
      label: 'centroid-a',
      city: centroidCity,
      countryCode: 'LU',
      isPublished: true,
      location: { lat: 49.61, lng: 6.1 },
    });
    await createFixtureProfile({
      label: 'centroid-b',
      city: centroidCity,
      countryCode: 'LU',
      isPublished: true,
      location: { lat: 49.62, lng: 6.11 },
    });
    await createFixtureProfile({
      label: 'centroid-c',
      city: centroidCity,
      countryCode: 'LU',
      isPublished: true,
      location: { lat: 49.63, lng: 6.13 },
    });
    await createFixtureProfile({
      label: 'excluded-published',
      city: excludedCity,
      countryCode: 'LU',
      isPublished: true,
      location: { lat: 49.5, lng: 6.0 },
    });
    await createFixtureProfile({
      label: 'excluded-unpublished',
      city: excludedCity,
      countryCode: 'LU',
      isPublished: false,
      location: { lat: 10, lng: 10 },
    });
    await createFixtureProfile({
      label: 'excluded-deleted',
      city: excludedCity,
      countryCode: 'LU',
      isPublished: true,
      deleted: true,
      location: { lat: 20, lng: 20 },
    });
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
    await app.close();
  });

  describe('GET /v1/cities', () => {
    it('sets a 5 minute public Cache-Control header', async () => {
      const response = await fastify().inject({ method: 'GET', url: '/v1/cities' });
      expect(response.statusCode).toBe(200);
      expect(response.headers['cache-control']).toBe('public, max-age=300');
    });

    it('only counts published profiles', async () => {
      const response = await fastify().inject({
        method: 'GET',
        url: `/v1/cities?q=${encodeURIComponent(mixedCity)}`,
      });
      const body = response.json<CityBody[]>();
      expect(body).toHaveLength(1);
      expect(body[0]).toMatchObject({ name: mixedCity, photographerCount: 1 });
    });

    it('matches a case-insensitive prefix', async () => {
      const response = await fastify().inject({
        method: 'GET',
        url: `/v1/cities?q=${encodeURIComponent(publishedCity.toUpperCase())}`,
      });
      const body = response.json<CityBody[]>();
      expect(body.map((city) => city.name)).toEqual([publishedCity]);
    });

    it('matches an accent-insensitive prefix', async () => {
      const foldedPrefix = accentedCity.replace('é', 'e');
      const response = await fastify().inject({
        method: 'GET',
        url: `/v1/cities?q=${encodeURIComponent(foldedPrefix)}`,
      });
      const body = response.json<CityBody[]>();
      expect(body.map((city) => city.name)).toEqual([accentedCity]);
    });

    it('does not match a non-prefix substring', async () => {
      const suffixOnly = publishedCity.slice(2);
      const response = await fastify().inject({
        method: 'GET',
        url: `/v1/cities?q=${encodeURIComponent(suffixOnly)}`,
      });
      const body = response.json<CityBody[]>();
      expect(body.map((city) => city.name)).not.toContain(publishedCity);
    });

    it('includes a city that matches the countryCode filter', async () => {
      const response = await fastify().inject({
        method: 'GET',
        url: `/v1/cities?q=${encodeURIComponent(countryFilterCity)}&countryCode=LU`,
      });
      const body = response.json<CityBody[]>();
      expect(body).toHaveLength(1);
      expect(body[0]).toMatchObject({ name: countryFilterCity, countryCode: 'LU' });
    });

    it('excludes a city that does not match the countryCode filter', async () => {
      const response = await fastify().inject({
        method: 'GET',
        url: `/v1/cities?q=${encodeURIComponent(countryFilterCity)}&countryCode=${NO_FIXTURE_COUNTRY_CODE}`,
      });
      const body = response.json<CityBody[]>();
      expect(body).toHaveLength(0);
    });

    it('orders a city with more photographers ahead of one with fewer', async () => {
      const response = await fastify().inject({
        method: 'GET',
        url: '/v1/cities?q=Fxcity&limit=20',
      });
      const body = response.json<CityBody[]>();
      const names = body.map((city) => city.name);
      expect(names.indexOf(busyCity)).toBeGreaterThanOrEqual(0);
      expect(names.indexOf(quietCity)).toBeGreaterThanOrEqual(0);
      expect(names.indexOf(busyCity)).toBeLessThan(names.indexOf(quietCity));
    });

    it('bounds the result to limit and breaks count ties by name', async () => {
      const response = await fastify().inject({
        method: 'GET',
        url: `/v1/cities?q=${encodeURIComponent('Fxcitylimit-')}&limit=2`,
      });
      const body = response.json<CityBody[]>();
      expect(body.map((city) => city.name)).toEqual([limitA, limitB]);
    });

    it('returns the fuller limit when raised', async () => {
      const response = await fastify().inject({
        method: 'GET',
        url: `/v1/cities?q=${encodeURIComponent('Fxcitylimit-')}&limit=3`,
      });
      const body = response.json<CityBody[]>();
      expect(body.map((city) => city.name)).toEqual([limitA, limitB, limitC]);
    });

    it('slugifies the city name', async () => {
      const response = await fastify().inject({
        method: 'GET',
        url: `/v1/cities?q=${encodeURIComponent(publishedCity)}`,
      });
      const body = response.json<CityBody[]>();
      expect(body[0]?.slug).toBe(publishedCity.toLowerCase().replace(/-+/g, '-'));
    });

    it('rejects a q longer than 60 characters with 400', async () => {
      const response = await fastify().inject({
        method: 'GET',
        url: `/v1/cities?q=${'a'.repeat(61)}`,
      });
      expect(response.statusCode).toBe(400);
    });

    it('rejects a limit above 20 with 400', async () => {
      const response = await fastify().inject({ method: 'GET', url: '/v1/cities?limit=21' });
      expect(response.statusCode).toBe(400);
    });

    it('rejects a limit below 1 with 400', async () => {
      const response = await fastify().inject({ method: 'GET', url: '/v1/cities?limit=0' });
      expect(response.statusCode).toBe(400);
    });

    it('rejects a lowercase countryCode with 400', async () => {
      const response = await fastify().inject({ method: 'GET', url: '/v1/cities?countryCode=lu' });
      expect(response.statusCode).toBe(400);
    });

    it('rejects an unknown query key with 400', async () => {
      const response = await fastify().inject({ method: 'GET', url: '/v1/cities?sort=name' });
      expect(response.statusCode).toBe(400);
    });

    it('returns the centroid of the published profiles snapped to 2 decimals', async () => {
      const response = await fastify().inject({
        method: 'GET',
        url: `/v1/cities?q=${encodeURIComponent(centroidCity)}`,
      });
      const body = response.json<CityBody[]>();
      expect(body).toHaveLength(1);
      expect(body[0]?.location).toEqual({ lat: 49.62, lng: 6.11 });
    });

    it('excludes unpublished and deleted profiles from the centroid', async () => {
      const response = await fastify().inject({
        method: 'GET',
        url: `/v1/cities?q=${encodeURIComponent(excludedCity)}`,
      });
      const body = response.json<CityBody[]>();
      expect(body).toHaveLength(1);
      expect(body[0]).toMatchObject({
        photographerCount: 1,
        location: { lat: 49.5, lng: 6 },
      });
    });
  });
});
