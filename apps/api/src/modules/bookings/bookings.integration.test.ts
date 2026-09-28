import { randomUUID } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createPrismaClient, type PrismaClient } from '@photoo/db';
import { Redis } from 'ioredis';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { PlatformSettingsService } from '../../common/platform-settings/platform-settings.service.js';
import { createTestApp } from '../../testing/create-test-app.js';
import { waitForLinkInEmail } from '../../testing/mailpit.js';
import { requireIntegrationEnv } from '../../testing/require-integration-env.js';
import { TEST_ENV } from '../../testing/test-env.js';
import { BookingReleaseService } from '../payments/booking-release.service.js';
import { FakeStripeGateway } from '../payments/stripe/fake-stripe-gateway.js';
import { STRIPE_GATEWAY } from '../payments/stripe/stripe-gateway.js';

const testEnv = requireIntegrationEnv(['TEST_DATABASE_URL', 'REDIS_URL']);
const PASSWORD = `photoo-test-${randomUUID()}`;
// Distinct per-file IP and coordinates (issue #97): shared Redis and DB with
// other integration suites.
const FAKE_IP = '10.50.26.1';
const RUN_ID = randomUUID().replaceAll('-', '').slice(0, 8);
const RUN_SEED = Number.parseInt(RUN_ID, 16);
const RUN_LAT = -30 + (RUN_SEED % 100) / 10;
const RUN_LNG = 60 + (RUN_SEED % 150) / 10;
const DAY_MS = 86_400_000;

interface BookingBody {
  id: string;
  status: string;
  clientId: string;
  total: { amountCents: number; currency: string };
  releaseDueAt: string | null;
  deliveredAt: string | null;
  releasedAt: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
}

describe('bookings integration', () => {
  if (!testEnv) {
    it.skip('skipped: TEST_DATABASE_URL or REDIS_URL is not set', () => undefined);
    return;
  }

  let app: NestFastifyApplication;
  let prisma: PrismaClient;
  let redis: Redis;
  const createdUserIds: string[] = [];
  const eventIds: string[] = [];

  function fastify() {
    return app.getHttpAdapter().getInstance();
  }

  function headers(token: string) {
    return { authorization: `Bearer ${token}` };
  }

  async function signUpAndSignIn(
    label: string,
    roles: readonly string[],
  ): Promise<{ token: string; id: string }> {
    const email = `bookings-${label}-${randomUUID()}@photoo.test`;
    const signUpResponse = await fastify().inject({
      method: 'POST',
      url: '/v1/auth/sign-up',
      remoteAddress: FAKE_IP,
      payload: { email, password: PASSWORD, roles, locale: 'en' },
    });
    const userId = signUpResponse.json<{ user: { id: string } }>().user.id;
    createdUserIds.push(userId);

    const link = await waitForLinkInEmail(email, /https?:\/\/\S*verify-email#token=\S+/);
    const token = decodeURIComponent(link.slice(link.indexOf('#token=') + '#token='.length));
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
    const body = signInResponse.json<{ user: { id: string }; session: { token: string } | null }>();
    if (!body.session) {
      throw new Error(`sign-in for ${label} did not return a session`);
    }
    return { token: body.session.token, id: body.user.id };
  }

  function gateway(): FakeStripeGateway {
    const instance = app.get<unknown>(STRIPE_GATEWAY);
    if (!(instance instanceof FakeStripeGateway)) {
      throw new Error('bookings integration: expected the fake gateway under TEST_ENV');
    }
    return instance;
  }

  async function createPublishedPhotographer(label: string) {
    const user = await signUpAndSignIn(label, ['photographer']);
    const response = await fastify().inject({
      method: 'POST',
      url: '/v1/me/photographer-profile',
      remoteAddress: FAKE_IP,
      headers: headers(user.token),
      payload: {
        displayName: `Fx Bookings Photog ${label}`,
        categories: ['wedding'],
        languages: ['en'],
        location: { lat: RUN_LAT, lng: RUN_LNG },
        city: `Fx Bookings City ${RUN_ID}`,
        countryCode: 'LU',
      },
    });
    expect(response.statusCode).toBe(201);
    const profileId = response.json<{ id: string }>().id;
    // The fake gateway only transfers to accounts it created, so the release
    // path needs a real fake account rather than a made-up acct_ id.
    const account = await gateway().createConnectedAccount({
      country: 'LU',
      metadata: { profileId },
      idempotencyKey: `bookings-it-${profileId}`,
    });
    await prisma.photographerProfile.update({
      where: { id: profileId },
      data: {
        verificationStatus: 'verified',
        stripeAccountId: account.id,
        stripeOnboardingComplete: true,
        stripePayoutsEnabled: true,
        isPublished: true,
      },
    });
    return { ...user, profileId };
  }

  function futureIso(daysFromNow: number): string {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() + daysFromNow);
    return date.toISOString();
  }

  async function pendingBooking(label: string) {
    const client = await signUpAndSignIn(`${label}-client`, ['client']);
    const photographer = await createPublishedPhotographer(`${label}-photog`);

    const requestResponse = await fastify().inject({
      method: 'POST',
      url: '/v1/requests',
      remoteAddress: FAKE_IP,
      headers: headers(client.token),
      payload: {
        title: 'Looking for a wedding photographer',
        category: 'wedding',
        description: 'Full day coverage needed.',
        eventDate: futureIso(30),
        dateFlexible: false,
        location: { lat: RUN_LAT, lng: RUN_LNG },
        address: {
          line1: '1 Fixture Way',
          city: `Fx Bookings City ${RUN_ID}`,
          postalCode: 'L-1000',
          countryCode: 'LU',
        },
        budgetMin: { amountCents: 100000, currency: 'EUR' },
        budgetMax: { amountCents: 200000, currency: 'EUR' },
        usage: 'personal',
      },
    });
    expect(requestResponse.statusCode).toBe(201);
    const requestId = requestResponse.json<{ id: string }>().id;

    const quoteResponse = await fastify().inject({
      method: 'POST',
      url: '/v1/quotes',
      remoteAddress: FAKE_IP,
      headers: headers(photographer.token),
      payload: {
        requestId,
        lineItems: [{ label: 'Coverage', qty: 2, unitCents: 12525 }],
        validUntil: futureIso(5),
      },
    });
    expect(quoteResponse.statusCode).toBe(201);
    const quote = quoteResponse.json<{ id: string }>();

    const acceptResponse = await fastify().inject({
      method: 'POST',
      url: `/v1/quotes/${quote.id}/accept`,
      remoteAddress: FAKE_IP,
      headers: headers(client.token),
    });
    expect(acceptResponse.statusCode).toBe(200);
    const bookingId = acceptResponse.json<{ bookingId: string | null }>().bookingId;
    if (!bookingId) {
      throw new Error('quote accept did not return a booking id');
    }
    return { client, photographer, bookingId };
  }

  async function paidBooking(label: string) {
    const booking = await pendingBooking(label);
    const intentResponse = await fastify().inject({
      method: 'POST',
      url: `/v1/bookings/${booking.bookingId}/payment-intent`,
      remoteAddress: FAKE_IP,
      headers: headers(booking.client.token),
    });
    expect(intentResponse.statusCode).toBe(200);
    const { paymentIntentId } = await prisma.booking.findUniqueOrThrow({
      where: { id: booking.bookingId },
      select: { paymentIntentId: true },
    });
    if (!paymentIntentId) {
      throw new Error('payment intent route did not store an id');
    }

    const chargeId = `ch_it_${randomUUID()}`;
    const event = {
      id: `evt_it_${randomUUID()}`,
      object: 'event',
      type: 'payment_intent.succeeded',
      livemode: false,
      data: {
        object: {
          id: paymentIntentId,
          object: 'payment_intent',
          amount: 25050,
          currency: 'eur',
          latest_charge: chargeId,
        },
      },
    };
    eventIds.push(event.id);
    const payload = JSON.stringify(event);
    const webhookResponse = await fastify().inject({
      method: 'POST',
      url: '/v1/stripe/webhook',
      remoteAddress: FAKE_IP,
      headers: {
        'content-type': 'application/json',
        'stripe-signature': gateway().signPayload(payload),
      },
      payload,
    });
    expect(webhookResponse.statusCode).toBe(200);
    const { status } = await prisma.booking.findUniqueOrThrow({
      where: { id: booking.bookingId },
      select: { status: true },
    });
    expect(status).toBe('paid_held');
    return { ...booking, chargeId };
  }

  function deliver(bookingId: string, token: string) {
    return fastify().inject({
      method: 'POST',
      url: `/v1/bookings/${bookingId}/delivery`,
      remoteAddress: FAKE_IP,
      headers: headers(token),
      payload: {
        message: 'Your photos are ready.',
        externalLink: 'https://example.com/gallery',
      },
    });
  }

  function acceptDelivery(bookingId: string, token: string) {
    return fastify().inject({
      method: 'POST',
      url: `/v1/bookings/${bookingId}/accept-delivery`,
      remoteAddress: FAKE_IP,
      headers: headers(token),
    });
  }

  function cancel(bookingId: string, token: string, reason?: string) {
    return fastify().inject({
      method: 'POST',
      url: `/v1/bookings/${bookingId}/cancel`,
      remoteAddress: FAKE_IP,
      headers: headers(token),
      payload: reason === undefined ? {} : { reason },
    });
  }

  async function clearRateLimitKeys(): Promise<void> {
    const patterns = [
      `rate-limit:*:${FAKE_IP}`,
      `lockout:*:${FAKE_IP}`,
      ...createdUserIds.flatMap((id) => [`rate-limit:*:${id}`, `lockout:*:${id}`]),
    ];
    const keys = (await Promise.all(patterns.map((pattern) => redis.keys(pattern)))).flat();
    if (keys.length > 0) {
      await redis.del(...keys);
    }
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
    await prisma.stripeEvent.deleteMany({ where: { id: { in: eventIds } } });
    if (createdUserIds.length > 0) {
      const bookings = await prisma.booking.findMany({
        where: { clientId: { in: createdUserIds } },
        select: { id: true },
      });
      const bookingIds = bookings.map((booking) => booking.id);
      await prisma.deliveryFile.deleteMany({
        where: { delivery: { bookingId: { in: bookingIds } } },
      });
      await prisma.delivery.deleteMany({ where: { bookingId: { in: bookingIds } } });
      await prisma.ledgerEntry.deleteMany({ where: { bookingId: { in: bookingIds } } });
      await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
      await prisma.conversation.deleteMany({
        where: { type: 'quote', participants: { some: { userId: { in: createdUserIds } } } },
      });
      await prisma.quote.deleteMany({ where: { clientId: { in: createdUserIds } } });
      await prisma.request.deleteMany({ where: { clientId: { in: createdUserIds } } });
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    await prisma.$disconnect();
    redis.disconnect();
    await app.close();
  });

  describe('GET /v1/bookings', () => {
    it('shows a booking to both parties only', async () => {
      const { client, photographer, bookingId } = await pendingBooking('read');
      const stranger = await signUpAndSignIn('read-stranger', ['client']);

      for (const party of [client, photographer]) {
        const list = await fastify().inject({
          method: 'GET',
          url: '/v1/bookings?limit=50',
          remoteAddress: FAKE_IP,
          headers: headers(party.token),
        });
        expect(list.statusCode).toBe(200);
        const items = list.json<{ items: BookingBody[] }>().items;
        expect(items.map((item) => item.id)).toEqual([bookingId]);

        const single = await fastify().inject({
          method: 'GET',
          url: `/v1/bookings/${bookingId}`,
          remoteAddress: FAKE_IP,
          headers: headers(party.token),
        });
        expect(single.statusCode).toBe(200);
        expect(single.json<BookingBody>()).toMatchObject({
          id: bookingId,
          clientId: client.id,
          status: 'pending_payment',
          total: { amountCents: 25050, currency: 'EUR' },
          releaseDueAt: null,
        });
      }

      const strangerList = await fastify().inject({
        method: 'GET',
        url: '/v1/bookings',
        remoteAddress: FAKE_IP,
        headers: headers(stranger.token),
      });
      expect(strangerList.statusCode).toBe(200);
      expect(strangerList.json<{ items: BookingBody[] }>().items).toEqual([]);

      const strangerGet = await fastify().inject({
        method: 'GET',
        url: `/v1/bookings/${bookingId}`,
        remoteAddress: FAKE_IP,
        headers: headers(stranger.token),
      });
      expect(strangerGet.statusCode).toBe(404);

      const anonymous = await fastify().inject({
        method: 'GET',
        url: `/v1/bookings/${bookingId}`,
        remoteAddress: FAKE_IP,
      });
      expect(anonymous.statusCode).toBe(401);
    });
  });

  describe('pay -> deliver -> accept -> release', () => {
    it('releases through the shared service and leaves a ledger that sums to zero', async () => {
      const { client, photographer, bookingId, chargeId } = await paidBooking('flow');
      const { autoReleaseDays } = await app.get(PlatformSettingsService).get();

      const byClient = await deliver(bookingId, client.token);
      expect(byClient.statusCode).toBe(403);

      const delivered = await deliver(bookingId, photographer.token);
      expect(delivered.statusCode).toBe(201);
      const delivery = delivered.json<{ delivery: { id: string; deliveredAt: string } }>().delivery;

      const afterDelivery = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
      expect(afterDelivery.status).toBe('delivered');
      expect(afterDelivery.releaseDueAt?.getTime()).toBe(
        new Date(delivery.deliveredAt).getTime() + autoReleaseDays * DAY_MS,
      );
      const transitions = await prisma.auditLog.findMany({
        where: { targetType: 'Booking', targetId: bookingId, action: { startsWith: 'booking.' } },
        select: { action: true },
      });
      expect(transitions.map((row) => row.action)).toEqual(
        expect.arrayContaining(['booking.paid_held', 'booking.in_progress', 'booking.delivered']),
      );

      const secondDelivery = await deliver(bookingId, photographer.token);
      expect(secondDelivery.statusCode).toBe(409);

      const byPhotographer = await acceptDelivery(bookingId, photographer.token);
      expect(byPhotographer.statusCode).toBe(403);

      const accepted = await acceptDelivery(bookingId, client.token);
      expect(accepted.statusCode).toBe(200);
      expect(accepted.json<BookingBody>()).toMatchObject({ id: bookingId, status: 'released' });

      const released = await prisma.booking.findUniqueOrThrow({
        where: { id: bookingId },
        include: { delivery: true },
      });
      expect(released.status).toBe('released');
      expect(released.transferId).toMatch(/^tr_fake/);
      expect(released.delivery?.acceptedAt).not.toBeNull();

      const ledger = await prisma.ledgerEntry.findMany({ where: { bookingId } });
      const rows = ledger.map((entry) => [entry.type, entry.amountCents, entry.stripeObjectId]);
      expect(rows).toHaveLength(3);
      expect(rows).toEqual(
        expect.arrayContaining([
          ['charge', 25050, chargeId],
          ['transfer', -23797, released.transferId],
          ['platform_fee', -1253, released.transferId],
        ]),
      );
      expect(ledger.reduce((sum, entry) => sum + entry.amountCents, 0)).toBe(0);

      const again = await acceptDelivery(bookingId, client.token);
      expect(again.statusCode).toBe(409);
      expect(await prisma.ledgerEntry.count({ where: { bookingId } })).toBe(3);
    });

    it('rejects a delivery before the booking is paid', async () => {
      const { photographer, bookingId } = await pendingBooking('unpaid');

      const response = await deliver(bookingId, photographer.token);

      expect(response.statusCode).toBe(409);
      expect(await prisma.delivery.count({ where: { bookingId } })).toBe(0);
    });

    it('releases at the fee snapshotted on the quote, not a later platform fee change', async () => {
      const { client, photographer, bookingId, chargeId } = await paidBooking('fee-snapshot');
      const delivered = await deliver(bookingId, photographer.token);
      expect(delivered.statusCode).toBe(201);

      const before = await prisma.platformSetting.findUniqueOrThrow({
        where: { key: 'feePercent' },
      });
      await prisma.platformSetting.update({ where: { key: 'feePercent' }, data: { value: 10 } });
      try {
        const accepted = await acceptDelivery(bookingId, client.token);
        expect(accepted.statusCode).toBe(200);
        expect(accepted.json<BookingBody>()).toMatchObject({ id: bookingId, status: 'released' });
      } finally {
        await prisma.platformSetting.update({
          where: { key: 'feePercent' },
          data: { value: before.value as number },
        });
      }

      const released = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
      expect(released.status).toBe('released');
      const ledger = await prisma.ledgerEntry.findMany({ where: { bookingId } });
      const rows = ledger.map((entry) => [entry.type, entry.amountCents, entry.stripeObjectId]);
      expect(rows).toEqual(
        expect.arrayContaining([
          ['charge', 25050, chargeId],
          ['transfer', -23797, released.transferId],
          ['platform_fee', -1253, released.transferId],
        ]),
      );
      expect(ledger.reduce((sum, entry) => sum + entry.amountCents, 0)).toBe(0);
    });

    it('leaves the delivery accepted when the transfer fails, and the next sweep releases it', async () => {
      const { client, photographer, bookingId } = await paidBooking('transfer-fail');
      const delivered = await deliver(bookingId, photographer.token);
      expect(delivered.statusCode).toBe(201);

      const profile = await prisma.photographerProfile.findUniqueOrThrow({
        where: { id: photographer.profileId },
      });
      const realAccountId = profile.stripeAccountId;
      if (!realAccountId) {
        throw new Error('fixture photographer has no Stripe account to restore');
      }
      await prisma.photographerProfile.update({
        where: { id: photographer.profileId },
        data: { stripeAccountId: 'acct_missing_it' },
      });

      const accepted = await acceptDelivery(bookingId, client.token);
      expect(accepted.statusCode).toBe(200);
      expect(accepted.json<BookingBody>()).toMatchObject({ id: bookingId, status: 'delivered' });

      const stillHeld = await prisma.booking.findUniqueOrThrow({
        where: { id: bookingId },
        include: { delivery: true },
      });
      expect(stillHeld.status).toBe('delivered');
      expect(stillHeld.transferId).toBeNull();
      expect(stillHeld.delivery?.acceptedAt).not.toBeNull();

      await prisma.photographerProfile.update({
        where: { id: photographer.profileId },
        data: { stripeAccountId: realAccountId },
      });

      const sweepResult = await app.get(BookingReleaseService).sweep();
      expect(sweepResult.released).toBeGreaterThanOrEqual(1);

      const released = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
      expect(released.status).toBe('released');
      expect(released.transferId).toMatch(/^tr_fake/);

      const ledger = await prisma.ledgerEntry.findMany({ where: { bookingId } });
      expect(ledger.reduce((sum, entry) => sum + entry.amountCents, 0)).toBe(0);
    });
  });

  describe('GET /v1/bookings/:id/documents/:document', () => {
    it('rejects an invalid document type before touching the booking', async () => {
      const client = await signUpAndSignIn('doc-invalid', ['client']);

      const response = await fastify().inject({
        method: 'GET',
        url: `/v1/bookings/${randomUUID()}/documents/not-a-real-document`,
        remoteAddress: FAKE_IP,
        headers: headers(client.token),
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('POST /v1/bookings/:id/cancel', () => {
    it('cancels an unpaid booking and stores the reason', async () => {
      const { client, bookingId } = await pendingBooking('cancel');

      const response = await cancel(bookingId, client.token, 'Plans changed');

      expect(response.statusCode).toBe(200);
      expect(response.json<BookingBody>()).toMatchObject({
        status: 'cancelled',
        cancellationReason: 'Plans changed',
      });
      expect(response.json<BookingBody>().cancelledAt).not.toBeNull();
    });

    it('refuses to cancel a paid booking', async () => {
      const { client, bookingId } = await paidBooking('cancel-paid');

      const response = await cancel(bookingId, client.token, 'Too late');

      expect(response.statusCode).toBe(409);
      const booking = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
      expect(booking.status).toBe('paid_held');
    });
  });
});
