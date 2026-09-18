import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrismaClient } from './index.js';
import { seedDatabase } from './seed.js';
import { requireIntegrationEnv } from './testing/require-integration-env.js';

const testEnv = requireIntegrationEnv(['TEST_DATABASE_URL']);

const FIXTURE_CLIENT_EMAIL = 'test-fixture.payments-client@photoo.test';
const FIXTURE_PHOTOGRAPHER_EMAIL = 'test-fixture.payments-photographer@photoo.test';
const FIXTURE_PHOTOGRAPHER_SLUG = 'test-fixture-payments-photographer';

describe('payments schema', () => {
  if (!testEnv) {
    it.skip(
      'enforces Booking/LedgerEntry uniqueness, StripeEvent idempotency and Restrict relations (skipped: TEST_DATABASE_URL is not set)',
    );
    return;
  }

  const prisma = createPrismaClient(testEnv.TEST_DATABASE_URL);

  let clientId: string;
  let photographerProfileId: string;
  let productId: string;
  let productTierId: string;

  async function deleteFixtures(): Promise<void> {
    await prisma.ledgerEntry.deleteMany({
      where: { booking: { clientId: { in: [clientId].filter(Boolean) } } },
    });
    await prisma.delivery.deleteMany({
      where: { booking: { clientId: { in: [clientId].filter(Boolean) } } },
    });
    await prisma.dispute.deleteMany({
      where: { booking: { clientId: { in: [clientId].filter(Boolean) } } },
    });
    await prisma.booking.deleteMany({ where: { clientId: { in: [clientId].filter(Boolean) } } });
    await prisma.quote.deleteMany({ where: { clientId: { in: [clientId].filter(Boolean) } } });
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
        name: 'Payments Fixture Client',
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
        name: 'Payments Fixture Photographer',
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
        displayName: 'Payments Fixture Photographer',
        bio: { en: 'Fixture profile for payments.test.ts.' },
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

  async function createQuote(overrides: { totalCents?: number } = {}) {
    const validUntil = new Date();
    validUntil.setUTCDate(validUntil.getUTCDate() + 7);

    return prisma.quote.create({
      data: {
        photographerId: photographerProfileId,
        clientId,
        productId,
        productTierId,
        lineItems: [{ label: 'Fixture session', qty: 1, unitCents: 10_000 }],
        subtotalCents: 10_000,
        platformFeeCents: 500,
        totalCents: overrides.totalCents ?? 10_000,
        feePercent: 5,
        licenceUsage: 'commercial',
        licenceTextVersion: 'v1',
        currency: 'EUR',
        validUntil,
        status: 'accepted',
      },
    });
  }

  async function createBooking(quoteId: string, overrides: { paymentIntentId?: string } = {}) {
    return prisma.booking.create({
      data: {
        quoteId,
        clientId,
        photographerId: photographerProfileId,
        scheduledAt: new Date(),
        status: 'paid_held',
        paymentIntentId: overrides.paymentIntentId ?? `pi_${randomUUID()}`,
      },
    });
  }

  describe('Booking.quoteId unique', () => {
    it('rejects a second booking for the same quote', async () => {
      const quote = await createQuote();
      await createBooking(quote.id);

      await expect(createBooking(quote.id)).rejects.toThrow();

      await prisma.booking.deleteMany({ where: { quoteId: quote.id } });
      await prisma.quote.delete({ where: { id: quote.id } });
    });
  });

  describe('Booking.paymentIntentId unique', () => {
    it('rejects a second booking with the same paymentIntentId', async () => {
      const firstQuote = await createQuote();
      const secondQuote = await createQuote();
      const paymentIntentId = `pi_${randomUUID()}`;
      await createBooking(firstQuote.id, { paymentIntentId });

      await expect(createBooking(secondQuote.id, { paymentIntentId })).rejects.toThrow();

      await prisma.booking.deleteMany({ where: { quoteId: firstQuote.id } });
      await prisma.quote.deleteMany({ where: { id: { in: [firstQuote.id, secondQuote.id] } } });
    });

    it('allows two bookings with no paymentIntentId (multiple nulls)', async () => {
      const firstQuote = await createQuote();
      const secondQuote = await createQuote();

      const firstBooking = await prisma.booking.create({
        data: {
          quoteId: firstQuote.id,
          clientId,
          photographerId: photographerProfileId,
          scheduledAt: new Date(),
        },
      });
      const secondBooking = await prisma.booking.create({
        data: {
          quoteId: secondQuote.id,
          clientId,
          photographerId: photographerProfileId,
          scheduledAt: new Date(),
        },
      });

      expect(firstBooking.paymentIntentId).toBeNull();
      expect(secondBooking.paymentIntentId).toBeNull();

      await prisma.booking.deleteMany({
        where: { id: { in: [firstBooking.id, secondBooking.id] } },
      });
      await prisma.quote.deleteMany({ where: { id: { in: [firstQuote.id, secondQuote.id] } } });
    });
  });

  describe('LedgerEntry unique (bookingId, type, stripeObjectId)', () => {
    it('rejects a replayed webhook writing the same ledger row twice', async () => {
      const quote = await createQuote();
      const booking = await createBooking(quote.id);

      await prisma.ledgerEntry.create({
        data: {
          bookingId: booking.id,
          type: 'charge',
          amountCents: 10_000,
          currency: 'EUR',
          stripeObjectId: 'ch_fixture_1',
        },
      });

      await expect(
        prisma.ledgerEntry.create({
          data: {
            bookingId: booking.id,
            type: 'charge',
            amountCents: 10_000,
            currency: 'EUR',
            stripeObjectId: 'ch_fixture_1',
          },
        }),
      ).rejects.toThrow();

      await prisma.ledgerEntry.deleteMany({ where: { bookingId: booking.id } });
      await prisma.booking.delete({ where: { id: booking.id } });
      await prisma.quote.delete({ where: { id: quote.id } });
    });

    it('allows the same type on the same booking with a different stripeObjectId', async () => {
      const quote = await createQuote();
      const booking = await createBooking(quote.id);

      await prisma.ledgerEntry.create({
        data: {
          bookingId: booking.id,
          type: 'refund',
          amountCents: 3_000,
          currency: 'EUR',
          stripeObjectId: 're_fixture_1',
        },
      });
      await prisma.ledgerEntry.create({
        data: {
          bookingId: booking.id,
          type: 'refund',
          amountCents: 2_000,
          currency: 'EUR',
          stripeObjectId: 're_fixture_2',
        },
      });

      const entries = await prisma.ledgerEntry.findMany({ where: { bookingId: booking.id } });
      expect(entries).toHaveLength(2);

      await prisma.ledgerEntry.deleteMany({ where: { bookingId: booking.id } });
      await prisma.booking.delete({ where: { id: booking.id } });
      await prisma.quote.delete({ where: { id: quote.id } });
    });
  });

  describe('LedgerEntry.booking Restrict', () => {
    it('rejects deleting a booking that still has ledger entries', async () => {
      const quote = await createQuote();
      const booking = await createBooking(quote.id);
      await prisma.ledgerEntry.create({
        data: {
          bookingId: booking.id,
          type: 'charge',
          amountCents: 10_000,
          currency: 'EUR',
          stripeObjectId: 'ch_fixture_restrict',
        },
      });

      await expect(prisma.booking.delete({ where: { id: booking.id } })).rejects.toThrow();

      await prisma.ledgerEntry.deleteMany({ where: { bookingId: booking.id } });
      await prisma.booking.delete({ where: { id: booking.id } });
      await prisma.quote.delete({ where: { id: quote.id } });
    });
  });

  describe('StripeEvent idempotency', () => {
    it('rejects inserting the same event id twice', async () => {
      const id = `evt_fixture_${randomUUID()}`;
      await prisma.stripeEvent.create({
        data: { id, type: 'payment_intent.succeeded', payload: { id } },
      });

      await expect(
        prisma.stripeEvent.create({
          data: { id, type: 'payment_intent.succeeded', payload: { id } },
        }),
      ).rejects.toThrow();

      await prisma.stripeEvent.delete({ where: { id } });
    });
  });

  describe('Dispute.openedBy Restrict', () => {
    it('rejects deleting a user who opened a dispute', async () => {
      const quote = await createQuote();
      const booking = await createBooking(quote.id);
      const disputant = await prisma.user.create({
        data: {
          email: `test-fixture.dispute-${randomUUID()}@photoo.test`,
          emailVerifiedAt: new Date(),
          name: 'Dispute Fixture User',
          locale: 'en',
          countryCode: 'LU',
          roles: ['client'],
          status: 'active',
        },
      });
      const dispute = await prisma.dispute.create({
        data: {
          bookingId: booking.id,
          openedById: disputant.id,
          reason: 'Item not as described',
        },
      });

      await expect(prisma.user.delete({ where: { id: disputant.id } })).rejects.toThrow();

      await prisma.dispute.delete({ where: { id: dispute.id } });
      await prisma.user.delete({ where: { id: disputant.id } });
      await prisma.booking.delete({ where: { id: booking.id } });
      await prisma.quote.delete({ where: { id: quote.id } });
    });
  });
});
