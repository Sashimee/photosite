import { randomUUID } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createPrismaClient, type PrismaClient } from '@photoo/db';
import { Redis } from 'ioredis';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../../testing/create-test-app.js';
import { waitForLinkInEmail } from '../../testing/mailpit.js';
import { requireIntegrationEnv } from '../../testing/require-integration-env.js';
import { TEST_ENV } from '../../testing/test-env.js';
import { StripeEventSweepService } from './stripe-event-sweep.service.js';
import { FakeStripeGateway } from './stripe/fake-stripe-gateway.js';
import { STRIPE_GATEWAY } from './stripe/stripe-gateway.js';

const testEnv = requireIntegrationEnv(['TEST_DATABASE_URL', 'REDIS_URL']);
const PASSWORD = `photoo-test-${randomUUID()}`;
// Distinct per-file IP and coordinates (issue #97): shared Redis and DB with
// other integration suites.
const FAKE_IP = '10.50.25.1';
const RUN_ID = randomUUID().replaceAll('-', '').slice(0, 8);
const RUN_SEED = Number.parseInt(RUN_ID, 16);
const RUN_LAT = -40 + (RUN_SEED % 100) / 10;
const RUN_LNG = 80 + (RUN_SEED % 150) / 10;

describe('stripe webhook integration', () => {
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

  function headers(token: string) {
    return { authorization: `Bearer ${token}` };
  }

  async function signUpAndSignIn(
    label: string,
    roles: readonly string[],
  ): Promise<{ token: string; id: string }> {
    const email = `stripe-webhook-${label}-${randomUUID()}@photoo.test`;
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

  async function createPublishedPhotographer(label: string) {
    const user = await signUpAndSignIn(label, ['photographer']);
    const response = await fastify().inject({
      method: 'POST',
      url: '/v1/me/photographer-profile',
      remoteAddress: FAKE_IP,
      headers: headers(user.token),
      payload: {
        displayName: `Fx Webhook Photog ${label}`,
        categories: ['wedding'],
        languages: ['en'],
        location: { lat: RUN_LAT, lng: RUN_LNG },
        city: `Fx Webhook City ${RUN_ID}`,
        countryCode: 'LU',
      },
    });
    expect(response.statusCode).toBe(201);
    const profileId = response.json<{ id: string }>().id;
    await prisma.photographerProfile.update({
      where: { id: profileId },
      data: {
        verificationStatus: 'verified',
        stripeAccountId: `acct_${profileId}`,
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
          city: `Fx Webhook City ${RUN_ID}`,
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
    const quote = quoteResponse.json<{ id: string; total: { amountCents: number } }>();

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
    return { client, photographer, quote, bookingId };
  }

  const eventIds: string[] = [];

  function gateway(): FakeStripeGateway {
    const instance = app.get<unknown>(STRIPE_GATEWAY);
    if (!(instance instanceof FakeStripeGateway)) {
      throw new Error('stripe webhook integration: expected the fake gateway under TEST_ENV');
    }
    return instance;
  }

  function postWebhook(payload: string, signature: string | null) {
    return fastify().inject({
      method: 'POST',
      url: '/v1/stripe/webhook',
      remoteAddress: FAKE_IP,
      headers: {
        'content-type': 'application/json',
        ...(signature === null ? {} : { 'stripe-signature': signature }),
      },
      payload,
    });
  }

  function sendEvent(event: object & { id: string }) {
    eventIds.push(event.id);
    const payload = JSON.stringify(event);
    return postWebhook(payload, gateway().signPayload(payload));
  }

  function paymentIntentEvent(
    type: 'payment_intent.succeeded' | 'payment_intent.payment_failed',
    paymentIntentId: string,
    object: Record<string, unknown> = {},
  ) {
    return {
      id: `evt_it_${randomUUID()}`,
      object: 'event',
      type,
      livemode: false,
      data: {
        object: {
          id: paymentIntentId,
          object: 'payment_intent',
          amount: 25050,
          currency: 'eur',
          latest_charge: `ch_it_${randomUUID()}`,
          ...object,
        },
      },
    };
  }

  async function paymentIntentFor(label: string) {
    const booking = await pendingBooking(label);
    const response = await fastify().inject({
      method: 'POST',
      url: `/v1/bookings/${booking.bookingId}/payment-intent`,
      remoteAddress: FAKE_IP,
      headers: headers(booking.client.token),
    });
    expect(response.statusCode).toBe(200);
    const { paymentIntentId } = await prisma.booking.findUniqueOrThrow({
      where: { id: booking.bookingId },
      select: { paymentIntentId: true },
    });
    if (!paymentIntentId) {
      throw new Error('payment intent route did not store an id');
    }
    return { ...booking, paymentIntentId };
  }

  function storedEvent(id: string) {
    return prisma.stripeEvent.findUnique({ where: { id } });
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

  describe('POST /v1/stripe/webhook', () => {
    it('returns 400 for a missing or wrong signature and stores nothing', async () => {
      const event = paymentIntentEvent('payment_intent.succeeded', 'pi_it_unsigned');
      eventIds.push(event.id);
      const payload = JSON.stringify(event);

      const missing = await postWebhook(payload, null);
      expect(missing.statusCode).toBe(400);

      const forged = await postWebhook(
        payload,
        new FakeStripeGateway('whsec_other').signPayload(payload),
      );
      expect(forged.statusCode).toBe(400);

      const tampered = await postWebhook(
        payload.replace('25050', '1'),
        gateway().signPayload(payload),
      );
      expect(tampered.statusCode).toBe(400);

      expect(await storedEvent(event.id)).toBeNull();
    });

    it('moves a paid booking to paid_held once, even when the event is replayed', async () => {
      const { bookingId, paymentIntentId } = await paymentIntentFor('happy');
      const event = paymentIntentEvent('payment_intent.succeeded', paymentIntentId);
      const chargeId = event.data.object.latest_charge;

      const first = await sendEvent(event);
      expect(first.statusCode).toBe(200);
      expect(first.json()).toEqual({ received: true });

      const booking = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
      expect(booking.status).toBe('paid_held');
      expect(booking.chargeId).toBe(chargeId);
      const ledger = await prisma.ledgerEntry.findMany({ where: { bookingId } });
      expect(ledger).toEqual([
        expect.objectContaining({
          type: 'charge',
          amountCents: 25050,
          currency: 'EUR',
          stripeObjectId: chargeId,
        }),
      ]);
      const audit = await prisma.auditLog.findMany({
        where: { targetType: 'Booking', targetId: bookingId, action: 'booking.paid_held' },
      });
      expect(audit).toHaveLength(1);
      expect(audit[0]?.after).toMatchObject({ paymentIntentId, chargeId, stripeEventId: event.id });
      expect((await storedEvent(event.id))?.processedAt).not.toBeNull();

      const replay = await sendEvent(event);
      expect(replay.statusCode).toBe(200);
      expect(await prisma.ledgerEntry.count({ where: { bookingId } })).toBe(1);
      expect(
        await prisma.auditLog.count({
          where: { targetType: 'Booking', targetId: bookingId, action: 'booking.paid_held' },
        }),
      ).toBe(1);
    });

    it('ignores an event whose livemode does not match the configured key', async () => {
      const { bookingId, paymentIntentId } = await paymentIntentFor('live');
      const event = {
        ...paymentIntentEvent('payment_intent.succeeded', paymentIntentId),
        livemode: true,
      };

      const response = await sendEvent(event);

      expect(response.statusCode).toBe(200);
      expect(await storedEvent(event.id)).toBeNull();
      const booking = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
      expect(booking.status).toBe('pending_payment');
    });

    it('records a payment for a booking that cannot become paid_held without changing it', async () => {
      const { bookingId, paymentIntentId } = await paymentIntentFor('cancelled');
      await prisma.booking.update({ where: { id: bookingId }, data: { status: 'cancelled' } });
      const event = paymentIntentEvent('payment_intent.succeeded', paymentIntentId);

      const response = await sendEvent(event);

      expect(response.statusCode).toBe(200);
      const booking = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
      expect(booking.status).toBe('cancelled');
      expect(booking.chargeId).toBeNull();
      expect(await prisma.ledgerEntry.count({ where: { bookingId } })).toBe(0);
      expect((await storedEvent(event.id))?.processedAt).not.toBeNull();
    });

    it('leaves the booking pending and the event unprocessed when the quote fee is off', async () => {
      const { bookingId, paymentIntentId, quote } = await paymentIntentFor('fee');
      await prisma.quote.update({ where: { id: quote.id }, data: { platformFeeCents: 1252 } });
      const event = paymentIntentEvent('payment_intent.succeeded', paymentIntentId);

      const response = await sendEvent(event);

      expect(response.statusCode).toBe(200);
      const booking = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
      expect(booking.status).toBe('pending_payment');
      expect(await prisma.ledgerEntry.count({ where: { bookingId } })).toBe(0);
      const stored = await storedEvent(event.id);
      expect(stored).not.toBeNull();
      expect(stored?.processedAt).toBeNull();
    });

    it('leaves the booking pending when the paid amount differs from the quote', async () => {
      const { bookingId, paymentIntentId } = await paymentIntentFor('amount');
      const event = paymentIntentEvent('payment_intent.succeeded', paymentIntentId, { amount: 1 });

      await sendEvent(event);

      const booking = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
      expect(booking.status).toBe('pending_payment');
      expect((await storedEvent(event.id))?.processedAt).toBeNull();
    });

    it('stores an event that arrives before its booking and applies it on the sweep', async () => {
      const { bookingId, paymentIntentId } = await paymentIntentFor('early');
      const earlyIntentId = `pi_it_early_${RUN_ID}`;
      const event = paymentIntentEvent('payment_intent.succeeded', earlyIntentId);

      const response = await sendEvent(event);
      expect(response.statusCode).toBe(200);
      expect((await storedEvent(event.id))?.processedAt).toBeNull();

      expect(paymentIntentId).not.toBe(earlyIntentId);
      await prisma.booking.update({
        where: { id: bookingId },
        data: { paymentIntentId: earlyIntentId },
      });

      const result = await app
        .get(StripeEventSweepService)
        .sweep(new Date(Date.now() + 10 * 60 * 1000));
      expect(result.processed).toBeGreaterThanOrEqual(1);

      const booking = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
      expect(booking.status).toBe('paid_held');
      expect((await storedEvent(event.id))?.processedAt).not.toBeNull();
      expect(await prisma.ledgerEntry.count({ where: { bookingId, type: 'charge' } })).toBe(1);
    });

    it('audits a failed payment and keeps the booking pending', async () => {
      const { bookingId, paymentIntentId } = await paymentIntentFor('failed');
      const event = paymentIntentEvent('payment_intent.payment_failed', paymentIntentId, {
        latest_charge: null,
        last_payment_error: { code: 'card_declined', decline_code: 'insufficient_funds' },
      });

      const response = await sendEvent(event);

      expect(response.statusCode).toBe(200);
      const booking = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
      expect(booking.status).toBe('pending_payment');
      const audit = await prisma.auditLog.findFirst({
        where: { targetType: 'Booking', targetId: bookingId, action: 'booking.payment_failed' },
      });
      expect(audit?.after).toMatchObject({
        paymentIntentId,
        errorCode: 'card_declined',
        declineCode: 'insufficient_funds',
      });
      expect((await storedEvent(event.id))?.processedAt).not.toBeNull();
    });

    it('records and acks an event type it does not handle', async () => {
      const event = {
        id: `evt_it_${randomUUID()}`,
        object: 'event',
        type: 'customer.created',
        livemode: false,
        data: { object: { id: 'cus_it', object: 'customer' } },
      };

      const response = await sendEvent(event);

      expect(response.statusCode).toBe(200);
      const stored = await storedEvent(event.id);
      expect(stored?.type).toBe('customer.created');
      expect(stored?.processedAt).not.toBeNull();
    });
  });
});
