import { randomUUID } from 'node:crypto';
import { createPrismaClient, type PrismaClient } from '@photoo/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { requireIntegrationEnv } from '../../testing/require-integration-env.js';
import { createListingExpiryProcessor } from './listing-expiry.processor.js';

const testEnv = requireIntegrationEnv(['TEST_DATABASE_URL']);

function fakeLogger() {
  return { log: () => undefined, warn: () => undefined, error: () => undefined };
}

describe('createListingExpiryProcessor against a real database', () => {
  if (!testEnv) {
    it.skip('skipped: TEST_DATABASE_URL is not set', () => undefined);
    return;
  }

  let prisma: PrismaClient;
  const runId = randomUUID().replaceAll('-', '').slice(0, 8);
  let userId: string;
  let professionalId: string;
  let lapsedOfferId: string;
  let liveOfferId: string;
  let closedOfferId: string;
  let lapsedListingId: string;

  async function createOffer(input: {
    slug: string;
    title: string;
    status: 'published' | 'closed';
    expiresAt: Date;
  }): Promise<string> {
    const offer = await prisma.jobOffer.create({
      data: {
        professionalId,
        slug: input.slug,
        title: input.title,
        description: 'Fixture job offer for the listing-expiry sweep.',
        category: 'event',
        city: 'Fixture City',
        countryCode: 'LU',
        remote: false,
        status: input.status,
        publishedAt: new Date('2000-01-01T00:00:00.000Z'),
        expiresAt: input.expiresAt,
      },
    });
    await prisma.$executeRaw`
      UPDATE "JobOffer"
      SET location = ST_SetSRID(ST_MakePoint(6.1319, 49.6116), 4326)::geography
      WHERE id = ${offer.id}
    `;
    return offer.id;
  }

  beforeAll(async () => {
    prisma = createPrismaClient(testEnv.TEST_DATABASE_URL);

    const user = await prisma.user.create({
      data: {
        email: `listing-expiry-${runId}@photoo.test`,
        emailVerifiedAt: new Date(),
        name: `Fx Listing Expiry ${runId}`,
        locale: 'en',
        countryCode: 'LU',
        roles: ['professional'],
        status: 'active',
      },
    });
    userId = user.id;

    const professional = await prisma.professionalProfile.create({
      data: { userId: user.id, companyName: `Fx Listing Expiry Co ${runId}` },
    });
    professionalId = professional.id;

    const longPast = new Date('2000-01-01T00:00:00.000Z');
    const farFuture = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    lapsedOfferId = await createOffer({
      slug: `fx-listing-expiry-lapsed-${runId}`,
      title: `Fx Listing Expiry Lapsed ${runId}`,
      status: 'published',
      expiresAt: longPast,
    });
    const lapsedListing = await prisma.listing.create({
      data: {
        ownerId: lapsedOfferId,
        kind: 'job_offer',
        plan: 'free',
        priceCents: 0,
        currency: 'EUR',
        paidAt: longPast,
        expiresAt: longPast,
      },
    });
    lapsedListingId = lapsedListing.id;
    await prisma.jobOffer.update({
      where: { id: lapsedOfferId },
      data: { listingId: lapsedListingId },
    });

    liveOfferId = await createOffer({
      slug: `fx-listing-expiry-live-${runId}`,
      title: `Fx Listing Expiry Live ${runId}`,
      status: 'published',
      expiresAt: farFuture,
    });

    closedOfferId = await createOffer({
      slug: `fx-listing-expiry-closed-${runId}`,
      title: `Fx Listing Expiry Closed ${runId}`,
      status: 'closed',
      expiresAt: longPast,
    });
  });

  afterAll(async () => {
    await prisma.jobOffer.deleteMany({
      where: { id: { in: [lapsedOfferId, liveOfferId, closedOfferId] } },
    });
    await prisma.listing.deleteMany({ where: { id: lapsedListingId } });
    await prisma.professionalProfile.deleteMany({ where: { id: professionalId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  // `listing_expiry.swept` audit rows are global (`targetType: 'System'`,
  // one row per sweep, no per-offer targetId to filter by), so counting the
  // whole table before/after would also catch a real scheduled sweep
  // running concurrently against `photoo_test` while this test runs.
  // Narrowing to `occurredAt` between two watermarks taken immediately
  // around each `processor()` call keeps the assertion scoped to this run.
  it('expires only the lapsed published offer and is idempotent on a second run', async () => {
    const processor = createListingExpiryProcessor({
      prisma: { client: prisma },
      logger: fakeLogger() as never,
    });

    const beforeFirstRun = new Date();
    await processor(undefined as never);
    const afterFirstRun = new Date();

    const lapsed = await prisma.jobOffer.findUniqueOrThrow({ where: { id: lapsedOfferId } });
    const live = await prisma.jobOffer.findUniqueOrThrow({ where: { id: liveOfferId } });
    const closed = await prisma.jobOffer.findUniqueOrThrow({ where: { id: closedOfferId } });
    expect(lapsed.status).toBe('expired');
    expect(live.status).toBe('published');
    expect(closed.status).toBe('closed');

    const auditLogsFromFirstRun = await prisma.auditLog.count({
      where: {
        action: 'listing_expiry.swept',
        occurredAt: { gte: beforeFirstRun, lte: afterFirstRun },
      },
    });
    expect(auditLogsFromFirstRun).toBe(1);

    const beforeSecondRun = new Date();
    await processor(undefined as never);
    const afterSecondRun = new Date();

    const lapsedAfterSecondRun = await prisma.jobOffer.findUniqueOrThrow({
      where: { id: lapsedOfferId },
    });
    expect(lapsedAfterSecondRun.status).toBe('expired');

    const auditLogsFromSecondRun = await prisma.auditLog.count({
      where: {
        action: 'listing_expiry.swept',
        occurredAt: { gte: beforeSecondRun, lte: afterSecondRun },
      },
    });
    expect(auditLogsFromSecondRun).toBe(0);
  });
});
