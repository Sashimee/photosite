import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrismaClient } from './index.js';
import {
  SEED_REQUEST_CLIENT_EMAIL,
  SEED_REQUEST_PHOTOGRAPHER_SLUG,
  SEED_REQUEST_TITLE,
  seedDatabase,
  seedRequestAndQuote,
} from './seed.js';
import { requireIntegrationEnv } from './testing/require-integration-env.js';

const testEnv = requireIntegrationEnv(['TEST_DATABASE_URL']);

const FIXTURE_CLIENT_EMAIL = 'test-fixture.requests-quotes-client@photoo.test';
const FIXTURE_PHOTOGRAPHER_EMAIL = 'test-fixture.requests-quotes-photographer@photoo.test';
const FIXTURE_PHOTOGRAPHER_SLUG = 'test-fixture-requests-quotes-photographer';

describe('requests and quotes schema', () => {
  if (!testEnv) {
    it.skip(
      'enforces the partial unique index and CHECK constraints (skipped: TEST_DATABASE_URL is not set)',
    );
    return;
  }

  const prisma = createPrismaClient(testEnv.TEST_DATABASE_URL);

  let clientId: string;
  let photographerProfileId: string;
  let productId: string;
  let productTierId: string;

  async function deleteFixtures(): Promise<void> {
    await prisma.quote.deleteMany({ where: { clientId: { in: [clientId].filter(Boolean) } } });
    await prisma.request.deleteMany({ where: { clientId: { in: [clientId].filter(Boolean) } } });
    if (photographerProfileId) {
      await prisma.photographerProfile.deleteMany({ where: { id: photographerProfileId } });
    }
    await prisma.user.deleteMany({
      where: { email: { in: [FIXTURE_CLIENT_EMAIL, FIXTURE_PHOTOGRAPHER_EMAIL] } },
    });
  }

  beforeAll(async () => {
    await seedDatabase(prisma);

    await prisma.user.deleteMany({
      where: { email: { in: [FIXTURE_CLIENT_EMAIL, FIXTURE_PHOTOGRAPHER_EMAIL] } },
    });

    const client = await prisma.user.create({
      data: {
        email: FIXTURE_CLIENT_EMAIL,
        emailVerifiedAt: new Date(),
        name: 'Requests Quotes Fixture Client',
        locale: 'en',
        countryCode: 'LU',
        roles: ['client'],
        status: 'active',
      },
    });
    clientId = client.id;

    const photographerUser = await prisma.user.create({
      data: {
        email: FIXTURE_PHOTOGRAPHER_EMAIL,
        emailVerifiedAt: new Date(),
        name: 'Requests Quotes Fixture Photographer',
        locale: 'en',
        countryCode: 'LU',
        roles: ['photographer'],
        status: 'active',
      },
    });

    const photographerProfile = await prisma.photographerProfile.create({
      data: {
        userId: photographerUser.id,
        slug: FIXTURE_PHOTOGRAPHER_SLUG,
        displayName: 'Requests Quotes Fixture Photographer',
        bio: { en: 'Fixture profile for requests-quotes.test.ts.' },
        links: { instagram: null, website: null, behance: null, other: [] },
        categories: ['wedding'],
        languages: ['en'],
        city: 'Reykjavik',
        countryCode: 'LU',
      },
    });
    photographerProfileId = photographerProfile.id;

    const product = await prisma.product.create({
      data: {
        profileId: photographerProfile.id,
        title: { en: 'Fixture product' },
        category: 'wedding',
        durationMinutes: 60,
        deliverables: { photos: 10 },
        basePriceCents: 10_000,
        currency: 'EUR',
        order: 1,
      },
    });
    productId = product.id;

    const productTier = await prisma.productTier.create({
      data: {
        productId: product.id,
        usage: 'commercial',
        priceCents: 10_000,
        currency: 'EUR',
        licenceTextVersion: 'v1',
      },
    });
    productTierId = productTier.id;
  });

  afterAll(async () => {
    await deleteFixtures();
    await prisma.$disconnect();
  });

  interface RequestFixtureOverrides {
    budgetMinCents?: number;
    budgetMaxCents?: number;
  }

  function requestData(overrides: RequestFixtureOverrides = {}) {
    const eventDate = new Date();
    eventDate.setUTCDate(eventDate.getUTCDate() + 90);
    const expiresAt = new Date();
    expiresAt.setUTCDate(expiresAt.getUTCDate() + 60);

    return {
      clientId,
      title: 'Fixture request',
      category: 'wedding' as const,
      description: 'Fixture request for requests-quotes.test.ts.',
      eventDate,
      dateFlexible: false,
      address: { street: 'Fixture street', city: 'Reykjavik', postalCode: '101' },
      city: 'Reykjavik',
      countryCode: 'LU',
      budgetMinCents: 100_00,
      budgetMaxCents: 300_00,
      currency: 'EUR',
      usage: 'personal' as const,
      expiresAt,
      ...overrides,
    };
  }

  interface QuoteFixtureOverrides {
    productId?: string | null;
    productTierId?: string | null;
    subtotalCents?: number;
    platformFeeCents?: number;
    totalCents?: number;
    licenceUsage?: 'personal' | 'commercial' | 'editorial' | 'extended';
    licenceTextVersion?: string;
  }

  function quoteData(requestId: string | null, overrides: QuoteFixtureOverrides = {}) {
    const validUntil = new Date();
    validUntil.setUTCDate(validUntil.getUTCDate() + 7);

    return {
      requestId,
      photographerId: photographerProfileId,
      clientId,
      lineItems: [{ label: 'Fixture session', qty: 1, unitCents: 10_000 }],
      subtotalCents: 10_000,
      platformFeeCents: 500,
      totalCents: 10_000,
      feePercent: 5,
      licenceUsage: 'personal' as const,
      currency: 'EUR',
      validUntil,
      ...overrides,
    };
  }

  describe('partial unique index on (requestId, photographerId) WHERE status = sent', () => {
    it('rejects a second sent quote and allows one again after the first is withdrawn', async () => {
      const request = await prisma.request.create({ data: requestData() });

      const firstQuote = await prisma.quote.create({ data: quoteData(request.id) });
      expect(firstQuote.status).toBe('sent');

      await expect(prisma.quote.create({ data: quoteData(request.id) })).rejects.toThrow();

      await prisma.quote.update({
        where: { id: firstQuote.id },
        data: { status: 'withdrawn' },
      });

      const secondQuote = await prisma.quote.create({ data: quoteData(request.id) });
      expect(secondQuote.status).toBe('sent');

      await prisma.quote.deleteMany({ where: { requestId: request.id } });
      await prisma.request.delete({ where: { id: request.id } });
    });
  });

  describe('CHECK constraints', () => {
    it('rejects a negative subtotalCents', async () => {
      const request = await prisma.request.create({ data: requestData() });

      await expect(
        prisma.quote.create({
          data: quoteData(request.id, { subtotalCents: -1, totalCents: -1 }),
        }),
      ).rejects.toThrow();

      await prisma.request.delete({ where: { id: request.id } });
    });

    it('rejects a negative platformFeeCents', async () => {
      const request = await prisma.request.create({ data: requestData() });

      await expect(
        prisma.quote.create({ data: quoteData(request.id, { platformFeeCents: -1 }) }),
      ).rejects.toThrow();

      await prisma.request.delete({ where: { id: request.id } });
    });

    it('rejects totalCents different from subtotalCents', async () => {
      const request = await prisma.request.create({ data: requestData() });

      await expect(
        prisma.quote.create({ data: quoteData(request.id, { totalCents: 10_001 }) }),
      ).rejects.toThrow();

      await prisma.request.delete({ where: { id: request.id } });
    });

    it('rejects a request whose budgetMinCents is above budgetMaxCents', async () => {
      await expect(
        prisma.request.create({
          data: requestData({ budgetMinCents: 400_00, budgetMaxCents: 100_00 }),
        }),
      ).rejects.toThrow();
    });

    it('allows a request whose budgetMinCents equals budgetMaxCents', async () => {
      const request = await prisma.request.create({
        data: requestData({ budgetMinCents: 200_00, budgetMaxCents: 200_00 }),
      });

      expect(request.budgetMinCents).toBe(request.budgetMaxCents);

      await prisma.request.delete({ where: { id: request.id } });
    });

    it('rejects a quote with neither requestId nor productId', async () => {
      await expect(
        prisma.quote.create({ data: quoteData(null, { productId: null }) }),
      ).rejects.toThrow();
    });

    it('allows a direct quote with productId and no requestId', async () => {
      const quote = await prisma.quote.create({
        data: quoteData(null, {
          productId,
          productTierId,
          licenceUsage: 'commercial',
          licenceTextVersion: 'v1',
        }),
      });

      expect(quote.requestId).toBeNull();
      expect(quote.productId).toBe(productId);

      await prisma.quote.delete({ where: { id: quote.id } });
    });
  });

  describe('licence snapshot', () => {
    it('keeps licenceUsage and licenceTextVersion after the product tier row is deleted', async () => {
      const tier = await prisma.productTier.create({
        data: {
          productId,
          usage: 'editorial',
          priceCents: 20_000,
          currency: 'EUR',
          licenceTextVersion: 'v2',
        },
      });

      const quote = await prisma.quote.create({
        data: quoteData(null, {
          productId,
          productTierId: tier.id,
          licenceUsage: 'editorial',
          licenceTextVersion: 'v2',
        }),
      });

      // Mirrors products.service.ts replacing all tiers on a product update
      // (deleteMany then recreate), which hard-deletes the row this quote's
      // productTierId points at.
      await prisma.productTier.delete({ where: { id: tier.id } });

      const afterTierDeleted = await prisma.quote.findUniqueOrThrow({ where: { id: quote.id } });
      expect(afterTierDeleted.productTierId).toBeNull();
      expect(afterTierDeleted.licenceUsage).toBe('editorial');
      expect(afterTierDeleted.licenceTextVersion).toBe('v2');

      await prisma.quote.delete({ where: { id: quote.id } });
    });
  });

  describe('seedRequestAndQuote', () => {
    // Deletes and recreates the seeded request/quote rather than relying on
    // seedDatabase alone, so this exercises the create path deterministically
    // regardless of whether a previous test run already seeded them.
    it('creates one request and one sent quote, and is idempotent on a second run', async () => {
      const seedClient = await prisma.user.findUniqueOrThrow({
        where: { email: SEED_REQUEST_CLIENT_EMAIL },
      });
      const seedPhotographer = await prisma.photographerProfile.findUniqueOrThrow({
        where: { slug: SEED_REQUEST_PHOTOGRAPHER_SLUG },
      });
      await prisma.quote.deleteMany({
        where: { clientId: seedClient.id, photographerId: seedPhotographer.id },
      });
      await prisma.request.deleteMany({
        where: { clientId: seedClient.id, title: SEED_REQUEST_TITLE },
      });

      await seedRequestAndQuote(prisma);

      const countAfterFirstRun = {
        requests: await prisma.request.count({
          where: { clientId: seedClient.id, title: SEED_REQUEST_TITLE },
        }),
        quotes: await prisma.quote.count({
          where: { clientId: seedClient.id, photographerId: seedPhotographer.id },
        }),
      };
      expect(countAfterFirstRun).toEqual({ requests: 1, quotes: 1 });

      const quote = await prisma.quote.findFirstOrThrow({
        where: { clientId: seedClient.id, photographerId: seedPhotographer.id },
      });
      expect(quote.status).toBe('sent');
      expect(quote.currency).toBe('EUR');
      expect(quote.totalCents).toBe(quote.subtotalCents);

      await seedRequestAndQuote(prisma);

      const countAfterSecondRun = {
        requests: await prisma.request.count({
          where: { clientId: seedClient.id, title: SEED_REQUEST_TITLE },
        }),
        quotes: await prisma.quote.count({
          where: { clientId: seedClient.id, photographerId: seedPhotographer.id },
        }),
      };
      expect(countAfterSecondRun).toEqual(countAfterFirstRun);
    });
  });

  describe('seedDatabase for Request/Quote', () => {
    it('is idempotent: running the seed again does not duplicate the seeded request or quote', async () => {
      const seedClient = await prisma.user.findUniqueOrThrow({
        where: { email: SEED_REQUEST_CLIENT_EMAIL },
      });
      const seedPhotographer = await prisma.photographerProfile.findUniqueOrThrow({
        where: { slug: SEED_REQUEST_PHOTOGRAPHER_SLUG },
      });

      await seedDatabase(prisma);
      const before = {
        requests: await prisma.request.count({
          where: { clientId: seedClient.id, title: SEED_REQUEST_TITLE },
        }),
        quotes: await prisma.quote.count({
          where: { clientId: seedClient.id, photographerId: seedPhotographer.id },
        }),
      };

      await seedDatabase(prisma);
      const after = {
        requests: await prisma.request.count({
          where: { clientId: seedClient.id, title: SEED_REQUEST_TITLE },
        }),
        quotes: await prisma.quote.count({
          where: { clientId: seedClient.id, photographerId: seedPhotographer.id },
        }),
      };

      expect(before).toEqual({ requests: 1, quotes: 1 });
      expect(after).toEqual(before);
    });
  });
});
