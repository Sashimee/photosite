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
// Distinct per-file IP and coordinates (issue #97): shared Redis and DB with
// other integration suites.
const FAKE_IP = '10.50.24.1';
const RUN_ID = randomUUID().replaceAll('-', '').slice(0, 8);
const RUN_SEED = Number.parseInt(RUN_ID, 16);
const RUN_LAT = -45 + (RUN_SEED % 100) / 10;
const RUN_LNG = 60 + (RUN_SEED % 150) / 10;

interface ApiErrorBody {
  code: string;
  message: string;
}

interface PaymentIntentBody {
  clientSecret: string;
  amount: { amountCents: number; currency: string };
}

describe('booking payments integration', () => {
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
    const email = `booking-payments-${label}-${randomUUID()}@photoo.test`;
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
        displayName: `Fx Booking Photog ${label}`,
        categories: ['wedding'],
        languages: ['en'],
        location: { lat: RUN_LAT, lng: RUN_LNG },
        city: `Fx Booking City ${RUN_ID}`,
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
          city: `Fx Booking City ${RUN_ID}`,
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

  function createPaymentIntent(token: string | null, bookingId: string, payload?: object) {
    return fastify().inject({
      method: 'POST',
      url: `/v1/bookings/${bookingId}/payment-intent`,
      remoteAddress: FAKE_IP,
      headers: token ? headers(token) : {},
      ...(payload ? { payload } : {}),
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

  describe('POST /v1/bookings/:id/payment-intent', () => {
    it('returns 401 without a session', async () => {
      const response = await createPaymentIntent(null, randomUUID());
      expect(response.statusCode).toBe(401);
    });

    it('returns 400 for an id that is not a uuid', async () => {
      const client = await signUpAndSignIn('bad-id', ['client']);
      const response = await createPaymentIntent(client.token, 'not-a-uuid');
      expect(response.statusCode).toBe(400);
    });

    it('charges the quote total, ignores a client-supplied amount and reuses the intent', async () => {
      const { client, quote, bookingId } = await pendingBooking('happy');
      expect(quote.total.amountCents).toBe(25050);

      const first = await createPaymentIntent(client.token, bookingId, {
        amountCents: 1,
        currency: 'USD',
      });
      expect(first.statusCode).toBe(200);
      const body = first.json<PaymentIntentBody>();
      expect(body.amount).toEqual({ amountCents: 25050, currency: 'EUR' });
      expect(body.clientSecret).toMatch(/^pi_.+_secret_/);

      const booking = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
      expect(booking.paymentIntentId).not.toBeNull();
      expect(body.clientSecret.startsWith(`${String(booking.paymentIntentId)}_secret_`)).toBe(true);
      expect(booking.status).toBe('pending_payment');

      const second = await createPaymentIntent(client.token, bookingId);
      expect(second.statusCode).toBe(200);
      expect(second.json<PaymentIntentBody>()).toEqual(body);
      const reread = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
      expect(reread.paymentIntentId).toBe(booking.paymentIntentId);
    });

    it('returns 404 to the photographer and to another client', async () => {
      const { photographer, bookingId } = await pendingBooking('foreign');
      const stranger = await signUpAndSignIn('stranger', ['client']);

      for (const token of [photographer.token, stranger.token]) {
        const response = await createPaymentIntent(token, bookingId);
        expect(response.statusCode).toBe(404);
        expect(response.json<ApiErrorBody>().code).toBe('NOT_FOUND');
      }
      const booking = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
      expect(booking.paymentIntentId).toBeNull();
    });

    it('returns 409 once the booking is no longer awaiting payment', async () => {
      const { client, bookingId } = await pendingBooking('paid');
      await prisma.booking.update({ where: { id: bookingId }, data: { status: 'paid_held' } });

      const response = await createPaymentIntent(client.token, bookingId);
      expect(response.statusCode).toBe(409);
      expect(response.json<ApiErrorBody>().code).toBe('CONFLICT');
    });

    it('returns 422 for a quote that is not in EUR and creates no intent', async () => {
      const { client, quote, bookingId } = await pendingBooking('usd');
      await prisma.quote.update({ where: { id: quote.id }, data: { currency: 'USD' } });

      const response = await createPaymentIntent(client.token, bookingId);
      expect(response.statusCode).toBe(422);
      const booking = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
      expect(booking.paymentIntentId).toBeNull();
    });
  });
});
