import { afterAll, describe, expect, it } from 'vitest';
import { createPrismaClient } from './index.js';
import { SEED_PHOTOGRAPHER_PROFILES, seedDatabase } from './seed.js';
import { requireIntegrationEnv } from './testing/require-integration-env.js';

const testEnv = requireIntegrationEnv(['TEST_DATABASE_URL']);

const LUXEMBOURG_CITY = { lat: 49.6116, lng: 6.1319 };

describe('photographer profile schema', () => {
  if (!testEnv) {
    it.skip(
      'seeds photographer profiles idempotently and supports ST_DWithin radius search (skipped: TEST_DATABASE_URL is not set)',
    );
    return;
  }

  const prisma = createPrismaClient(testEnv.TEST_DATABASE_URL);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // A prior `pnpm db:seed` run (CI seeds before running this suite) already
  // leaves these demo profiles in place, which would otherwise make
  // `seedPhotographerProfile`'s creation path un-exercised by this suite.
  // Tearing a profile down first forces `seedDatabase` to recreate it.
  async function resetSeedPhotographerProfiles(): Promise<void> {
    for (const spec of SEED_PHOTOGRAPHER_PROFILES) {
      const profile = await prisma.photographerProfile.findUnique({ where: { slug: spec.slug } });
      if (profile) {
        await prisma.photographerProfile.delete({ where: { id: profile.id } });
      }
      await prisma.upload.deleteMany({
        where: { objectKey: { startsWith: `seed/${spec.slug}/` } },
      });
      await prisma.user.deleteMany({ where: { email: spec.email } });
    }
  }

  it('seeds one published, verified profile per SEED_PHOTOGRAPHER_PROFILES entry', async () => {
    await resetSeedPhotographerProfiles();
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
