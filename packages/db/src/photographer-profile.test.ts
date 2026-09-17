import { hash } from '@node-rs/argon2';
import { afterAll, describe, expect, it } from 'vitest';
import { createPrismaClient } from './index.js';
import {
  SEED_PHOTOGRAPHER_PROFILES,
  getSeedUserPassword,
  seedDatabase,
  seedPhotographerProfile,
  type SeedPhotographerProfileSpec,
} from './seed.js';
import { requireIntegrationEnv } from './testing/require-integration-env.js';

const testEnv = requireIntegrationEnv(['TEST_DATABASE_URL']);

const LUXEMBOURG_CITY = { lat: 49.6116, lng: 6.1319 };

// Own slug/email/coordinates, disjoint from SEED_PHOTOGRAPHER_PROFILES and
// far from every seed city, so this fixture never collides with the seeded
// demo rows the api integration suite reads concurrently (turbo runs both
// against the same TEST_DATABASE_URL) and never shows up in the radius
// searches below.
const TEST_FIXTURE_PROFILE: SeedPhotographerProfileSpec = {
  email: 'test-fixture.photographer-profile@photoo.test',
  slug: 'test-fixture-photographer-profile',
  displayName: 'Test Fixture Photographer',
  headline: 'Fixture profile for photographer-profile.test.ts',
  bio: 'Created and torn down by photographer-profile.test.ts only; never part of SEED_PHOTOGRAPHER_PROFILES.',
  city: 'Reykjavik',
  lat: 64.1466,
  lng: -21.9426,
  serviceRadiusKm: 15,
  categories: ['portrait'],
  languages: ['en'],
  products: [
    {
      title: 'Fixture session',
      category: 'portrait',
      durationMinutes: 60,
      basePriceCents: 10000,
      deliverables: { photos: 10, editedPhotos: 5, turnaroundDays: 5, onlineGallery: true },
      tiers: [{ usage: 'personal', priceCents: 10000 }],
    },
  ],
  portfolioImages: [{ order: 1, width: 2560, height: 1707 }],
};

describe('photographer profile schema', () => {
  if (!testEnv) {
    it.skip(
      'seeds photographer profiles idempotently and supports ST_DWithin radius search (skipped: TEST_DATABASE_URL is not set)',
    );
    return;
  }

  const prisma = createPrismaClient(testEnv.TEST_DATABASE_URL);

  // Deletes only the rows this fixture itself created, in the same order
  // seed data is torn down elsewhere: the profile first (cascades its
  // portfolio images, products and tiers), then its uploads, then its user.
  async function deleteFixtureProfile(): Promise<void> {
    const profile = await prisma.photographerProfile.findUnique({
      where: { slug: TEST_FIXTURE_PROFILE.slug },
    });
    if (profile) {
      await prisma.photographerProfile.delete({ where: { id: profile.id } });
    }
    await prisma.upload.deleteMany({
      where: { objectKey: { startsWith: `seed/${TEST_FIXTURE_PROFILE.slug}/` } },
    });
    await prisma.user.deleteMany({ where: { email: TEST_FIXTURE_PROFILE.email } });
  }

  afterAll(async () => {
    await deleteFixtureProfile();
    await prisma.$disconnect();
  });

  it('seeds one published, verified profile per SEED_PHOTOGRAPHER_PROFILES entry', async () => {
    await seedDatabase(prisma);

    for (const spec of SEED_PHOTOGRAPHER_PROFILES) {
      const profile = await prisma.photographerProfile.findUniqueOrThrow({
        where: { slug: spec.slug },
        include: { portfolioImages: true, products: { include: { tiers: true } } },
      });

      expect(profile.displayName).toBe(spec.displayName);
      expect(profile.city).toBe(spec.city);
      expect(profile.countryCode).toBe('LU');
      expect(profile.verificationStatus).toBe('verified');
      expect(profile.stripePayoutsEnabled).toBe(true);
      expect(profile.isPublished).toBe(true);
      expect(profile.avatarUploadId).not.toBeNull();
      expect(profile.coverUploadId).not.toBeNull();
      expect(profile.portfolioImages).toHaveLength(spec.portfolioImages.length);
      for (const image of profile.portfolioImages) {
        expect(image.status).toBe('approved');
      }
      expect(profile.products).toHaveLength(spec.products.length);
      for (const [index, product] of profile.products.entries()) {
        const productSpec = spec.products[index];
        if (!productSpec) {
          throw new Error(`no product spec at index ${String(index)} for ${spec.slug}`);
        }
        expect(product.tiers).toHaveLength(productSpec.tiers.length);
        expect(product.currency).toBe('EUR');
      }
    }
  });

  it('is idempotent: running the seed again does not duplicate profiles, products, tiers or portfolio images', async () => {
    await seedDatabase(prisma);
    const slugs = SEED_PHOTOGRAPHER_PROFILES.map((spec) => spec.slug);

    const before = {
      profiles: await prisma.photographerProfile.count({ where: { slug: { in: slugs } } }),
      portfolioImages: await prisma.portfolioImage.count({
        where: { profile: { slug: { in: slugs } } },
      }),
      products: await prisma.product.count({ where: { profile: { slug: { in: slugs } } } }),
      tiers: await prisma.productTier.count({
        where: { product: { profile: { slug: { in: slugs } } } },
      }),
    };

    await seedDatabase(prisma);

    const after = {
      profiles: await prisma.photographerProfile.count({ where: { slug: { in: slugs } } }),
      portfolioImages: await prisma.portfolioImage.count({
        where: { profile: { slug: { in: slugs } } },
      }),
      products: await prisma.product.count({ where: { profile: { slug: { in: slugs } } } }),
      tiers: await prisma.productTier.count({
        where: { product: { profile: { slug: { in: slugs } } } },
      }),
    };

    expect(after).toEqual(before);
  });

  // Exercises seedPhotographerProfile's create path directly against its own
  // fixture, rather than deleting and recreating the seeded demo profiles
  // (a cross-package race: turbo runs the api integration suite against the
  // same TEST_DATABASE_URL concurrently).
  it('seedPhotographerProfile creates a profile and is idempotent on a second run', async () => {
    await deleteFixtureProfile();
    const passwordHash = await hash(getSeedUserPassword());

    await seedPhotographerProfile(prisma, TEST_FIXTURE_PROFILE, passwordHash, null);

    const created = await prisma.photographerProfile.findUniqueOrThrow({
      where: { slug: TEST_FIXTURE_PROFILE.slug },
      include: { portfolioImages: true, products: { include: { tiers: true } } },
    });

    expect(created.displayName).toBe(TEST_FIXTURE_PROFILE.displayName);
    expect(created.city).toBe(TEST_FIXTURE_PROFILE.city);
    expect(created.countryCode).toBe('LU');
    expect(created.verificationStatus).toBe('verified');
    expect(created.stripePayoutsEnabled).toBe(true);
    expect(created.isPublished).toBe(true);
    expect(created.avatarUploadId).not.toBeNull();
    expect(created.coverUploadId).not.toBeNull();
    expect(created.portfolioImages).toHaveLength(TEST_FIXTURE_PROFILE.portfolioImages.length);
    for (const image of created.portfolioImages) {
      expect(image.status).toBe('approved');
    }
    expect(created.products).toHaveLength(TEST_FIXTURE_PROFILE.products.length);
    for (const [index, product] of created.products.entries()) {
      const productSpec = TEST_FIXTURE_PROFILE.products[index];
      if (!productSpec) {
        throw new Error(`no product spec at index ${String(index)}`);
      }
      expect(product.tiers).toHaveLength(productSpec.tiers.length);
      expect(product.currency).toBe('EUR');
    }

    await seedPhotographerProfile(prisma, TEST_FIXTURE_PROFILE, passwordHash, null);

    const after = {
      profiles: await prisma.photographerProfile.count({
        where: { slug: TEST_FIXTURE_PROFILE.slug },
      }),
      portfolioImages: await prisma.portfolioImage.count({
        where: { profile: { slug: TEST_FIXTURE_PROFILE.slug } },
      }),
      products: await prisma.product.count({
        where: { profile: { slug: TEST_FIXTURE_PROFILE.slug } },
      }),
      tiers: await prisma.productTier.count({
        where: { product: { profile: { slug: TEST_FIXTURE_PROFILE.slug } } },
      }),
    };

    expect(after).toEqual({
      profiles: 1,
      portfolioImages: TEST_FIXTURE_PROFILE.portfolioImages.length,
      products: TEST_FIXTURE_PROFILE.products.length,
      tiers: TEST_FIXTURE_PROFILE.products.reduce((sum, product) => sum + product.tiers.length, 0),
    });
  });

  describe('location ST_DWithin radius search', () => {
    it('returns only the Luxembourg City profile within a 10km radius', async () => {
      await seedDatabase(prisma);

      const nearby = await prisma.$queryRaw<{ slug: string }[]>`
        SELECT slug FROM "PhotographerProfile"
        WHERE "deletedAt" IS NULL
          AND ST_DWithin(
            location,
            ST_SetSRID(ST_MakePoint(${LUXEMBOURG_CITY.lng}, ${LUXEMBOURG_CITY.lat}), 4326)::geography,
            ${10_000}
          )
        ORDER BY slug
      `;

      expect(nearby.map((row) => row.slug)).toEqual(['sofia-martins']);
    });

    it('includes Esch-sur-Alzette but not Ettelbruck within a 20km radius', async () => {
      await seedDatabase(prisma);

      const nearby = await prisma.$queryRaw<{ slug: string }[]>`
        SELECT slug FROM "PhotographerProfile"
        WHERE "deletedAt" IS NULL
          AND ST_DWithin(
            location,
            ST_SetSRID(ST_MakePoint(${LUXEMBOURG_CITY.lng}, ${LUXEMBOURG_CITY.lat}), 4326)::geography,
            ${20_000}
          )
        ORDER BY slug
      `;

      expect(nearby.map((row) => row.slug)).toEqual(['karim-diallo', 'sofia-martins']);
    });

    it('excludes all seeded profiles within a 1km radius of a point far from every seed city', async () => {
      await seedDatabase(prisma);

      const nearby = await prisma.$queryRaw<{ slug: string }[]>`
        SELECT slug FROM "PhotographerProfile"
        WHERE "deletedAt" IS NULL
          AND ST_DWithin(
            location,
            ST_SetSRID(ST_MakePoint(6.0, 50.0), 4326)::geography,
            ${1_000}
          )
      `;

      expect(nearby).toHaveLength(0);
    });
  });
});
