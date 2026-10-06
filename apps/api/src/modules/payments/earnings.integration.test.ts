import { randomUUID } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createPrismaClient, type PrismaClient } from '@photoo/db';
import { EarningsResponseSchema } from '@photoo/shared';
import { Redis } from 'ioredis';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { createTestApp } from '../../testing/create-test-app.js';
import { waitForLinkInEmail } from '../../testing/mailpit.js';
import { requireIntegrationEnv } from '../../testing/require-integration-env.js';
import { TEST_ENV } from '../../testing/test-env.js';

const testEnv = requireIntegrationEnv(['TEST_DATABASE_URL', 'REDIS_URL']);
const PASSWORD = `photoo-test-${randomUUID()}`;
// Distinct per-file IP and coordinates (issue #97): shared Redis and DB with
// other integration suites.
const FAKE_IP = '10.50.27.1';
const RUN_ID = randomUUID().replaceAll('-', '').slice(0, 8);
const RUN_SEED = Number.parseInt(RUN_ID, 16);
const RUN_LAT = -30 + (RUN_SEED % 100) / 10;
const RUN_LNG = -60 + (RUN_SEED % 150) / 10;

type Earnings = z.infer<typeof EarningsResponseSchema>;
type BookingStatus =
  | 'pending_payment'
  | 'paid_held'
  | 'in_progress'
  | 'delivered'
  | 'released'
  | 'refunded'
  | 'disputed'
  | 'cancelled';

interface LedgerSeed {
  type: 'charge' | 'platform_fee' | 'transfer' | 'refund' | 'reversal';
  amountCents: number;
  occurredAt: Date;
}

interface BookingSeed {
  status: BookingStatus;
  subtotalCents: number;
  platformFeeCents: number;
  currency?: string;
  ledger?: LedgerSeed[];
}

function at(minutesAgo: number): Date {
  return new Date(Date.now() - minutesAgo * 60_000);
}

describe('GET /v1/me/earnings integration', () => {
  if (!testEnv) {
    it.skip('skipped: TEST_DATABASE_URL or REDIS_URL is not set', () => undefined);
    return;
  }

  let app: NestFastifyApplication;
  let prisma: PrismaClient;
  let redis: Redis;
  const createdUserIds: string[] = [];
  const createdProfileIds: string[] = [];

  function fastify() {
    return app.getHttpAdapter().getInstance();
  }

  async function signUpAndSignIn(
    label: string,
    roles: readonly string[],
  ): Promise<{ token: string; id: string }> {
    const email = `earnings-${label}-${randomUUID()}@photoo.test`;
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

  async function createPhotographer(label: string) {
    const user = await signUpAndSignIn(label, ['photographer']);
    const response = await fastify().inject({
      method: 'POST',
      url: '/v1/me/photographer-profile',
      remoteAddress: FAKE_IP,
      headers: { authorization: `Bearer ${user.token}` },
      payload: {
        displayName: `Fx Earnings Photog ${label}`,
        categories: ['wedding'],
        languages: ['en'],
        location: { lat: RUN_LAT, lng: RUN_LNG },
        city: `Fx Earnings City ${RUN_ID}`,
        countryCode: 'LU',
      },
    });
    expect(response.statusCode).toBe(201);
    const profileId = response.json<{ id: string }>().id;
    createdProfileIds.push(profileId);
    const product = await prisma.product.create({
      data: {
        profileId,
        title: { en: 'Fixture shoot' },
        category: 'wedding',
        durationMinutes: 60,
        deliverables: [],
        basePriceCents: 10000,
        currency: 'EUR',
        order: 0,
      },
    });
    return { ...user, profileId, productId: product.id };
  }

  async function seedBooking(
    photographer: { profileId: string; productId: string },
    clientId: string,
    seed: BookingSeed,
  ): Promise<string> {
    const currency = seed.currency ?? 'EUR';
    const quote = await prisma.quote.create({
      data: {
        photographerId: photographer.profileId,
        clientId,
        productId: photographer.productId,
        lineItems: [{ label: 'Coverage', qty: 1, unitCents: seed.subtotalCents }],
        subtotalCents: seed.subtotalCents,
        platformFeeCents: seed.platformFeeCents,
        totalCents: seed.subtotalCents,
        feePercent: '5.00',
        licenceUsage: 'personal',
        currency,
        validUntil: at(-60 * 24),
        status: 'accepted',
      },
    });
    const booking = await prisma.booking.create({
      data: {
        quoteId: quote.id,
        clientId,
        photographerId: photographer.profileId,
        status: seed.status,
      },
    });
    if (seed.ledger && seed.ledger.length > 0) {
      await prisma.ledgerEntry.createMany({
        data: seed.ledger.map((entry) => ({
          bookingId: booking.id,
          type: entry.type,
          amountCents: entry.amountCents,
          currency,
          stripeObjectId: `${entry.type}_${randomUUID()}`,
          occurredAt: entry.occurredAt,
        })),
      });
    }
    return booking.id;
  }

  function getEarnings(token: string | null) {
    return fastify().inject({
      method: 'GET',
      url: '/v1/me/earnings',
      remoteAddress: FAKE_IP,
      headers: token ? { authorization: `Bearer ${token}` } : {},
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

  let client: { token: string; id: string };
  let main: Awaited<ReturnType<typeof createPhotographer>>;
  let other: Awaited<ReturnType<typeof createPhotographer>>;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    app = await createTestApp({
      ...TEST_ENV,
      DATABASE_URL: testEnv.TEST_DATABASE_URL,
      REDIS_URL: testEnv.REDIS_URL,
    });
    prisma = createPrismaClient(testEnv.TEST_DATABASE_URL);
    redis = new Redis(testEnv.REDIS_URL);
    await clearRateLimitKeys();

    client = await signUpAndSignIn('client', ['client']);
    main = await createPhotographer('main');
    other = await createPhotographer('other');

    const seeds: Record<string, BookingSeed> = {
      releasedThenPartlyReversed: {
        status: 'released',
        subtotalCents: 25050,
        platformFeeCents: 1253,
        ledger: [
          { type: 'charge', amountCents: 25050, occurredAt: at(300) },
          { type: 'transfer', amountCents: -23797, occurredAt: at(200) },
          { type: 'platform_fee', amountCents: -1253, occurredAt: at(200) },
          { type: 'reversal', amountCents: 2000, occurredAt: at(30) },
        ],
      },
      released: {
        status: 'released',
        subtotalCents: 10000,
        platformFeeCents: 500,
        ledger: [
          { type: 'charge', amountCents: 10000, occurredAt: at(100) },
          { type: 'transfer', amountCents: -9500, occurredAt: at(10) },
          { type: 'platform_fee', amountCents: -500, occurredAt: at(10) },
        ],
      },
      disputedAfterRelease: {
        status: 'disputed',
        subtotalCents: 5000,
        platformFeeCents: 250,
        ledger: [
          { type: 'charge', amountCents: 5000, occurredAt: at(600) },
          { type: 'transfer', amountCents: -4750, occurredAt: at(500) },
        ],
      },
      paidHeld: { status: 'paid_held', subtotalCents: 10000, platformFeeCents: 500 },
      inProgress: { status: 'in_progress', subtotalCents: 20000, platformFeeCents: 1000 },
      deliveredPartlyRefunded: {
        status: 'delivered',
        subtotalCents: 30000,
        platformFeeCents: 1500,
        ledger: [
          { type: 'charge', amountCents: 30000, occurredAt: at(90) },
          { type: 'refund', amountCents: -3000, occurredAt: at(80) },
        ],
      },
      disputedBeforeRelease: { status: 'disputed', subtotalCents: 4000, platformFeeCents: 200 },
      refunded: {
        status: 'refunded',
        subtotalCents: 7000,
        platformFeeCents: 350,
        ledger: [
          { type: 'charge', amountCents: 7000, occurredAt: at(70) },
          { type: 'refund', amountCents: -7000, occurredAt: at(60) },
        ],
      },
      cancelled: { status: 'cancelled', subtotalCents: 8000, platformFeeCents: 400 },
      pendingPayment: { status: 'pending_payment', subtotalCents: 9000, platformFeeCents: 450 },
      usdHeld: { status: 'paid_held', subtotalCents: 8000, platformFeeCents: 400, currency: 'USD' },
      usdReleased: {
        status: 'released',
        subtotalCents: 2000,
        platformFeeCents: 100,
        currency: 'USD',
        ledger: [{ type: 'transfer', amountCents: -1900, occurredAt: at(5) }],
      },
    };
    for (const [key, seed] of Object.entries(seeds)) {
      ids[key] = await seedBooking(main, client.id, seed);
    }

    ids.otherReleased = await seedBooking(other, client.id, {
      status: 'released',
      subtotalCents: 100000,
      platformFeeCents: 5000,
      ledger: [{ type: 'transfer', amountCents: -95000, occurredAt: at(1) }],
    });
    ids.otherHeld = await seedBooking(other, client.id, {
      status: 'paid_held',
      subtotalCents: 50000,
      platformFeeCents: 2500,
    });
  });

  afterEach(async () => {
    await clearRateLimitKeys();
  });

  afterAll(async () => {
    if (createdProfileIds.length > 0) {
      const bookings = await prisma.booking.findMany({
        where: { photographerId: { in: createdProfileIds } },
        select: { id: true },
      });
      const bookingIds = bookings.map((booking) => booking.id);
      await prisma.ledgerEntry.deleteMany({ where: { bookingId: { in: bookingIds } } });
      await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
      await prisma.quote.deleteMany({ where: { photographerId: { in: createdProfileIds } } });
      await prisma.auditLog.deleteMany({ where: { targetId: { in: createdProfileIds } } });
    }
    if (createdUserIds.length > 0) {
      await prisma.auditLog.deleteMany({ where: { actorId: { in: createdUserIds } } });
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    await prisma.$disconnect();
    redis.disconnect();
    await app.close();
  });

  async function mainEarnings(): Promise<Earnings> {
    const response = await getEarnings(main.token);
    expect(response.statusCode).toBe(200);
    return EarningsResponseSchema.parse(response.json());
  }

  it('returns 401 without a session', async () => {
    const response = await getEarnings(null);
    expect(response.statusCode).toBe(401);
  });

  it('returns 403 for a client', async () => {
    const response = await getEarnings(client.token);
    expect(response.statusCode).toBe(403);
    expect(response.json<{ code: string }>().code).toBe('FORBIDDEN');
  });

  it('returns empty arrays for a photographer with no bookings', async () => {
    const fresh = await createPhotographer('fresh');
    const response = await getEarnings(fresh.token);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ totals: [], recent: [] });
  });

  it('reports released as transfers minus reversals and held from the quote snapshot, per currency', async () => {
    const earnings = await mainEarnings();
    expect(earnings.totals).toEqual([
      {
        currency: 'EUR',
        // 23797 - 2000 reversed, 9500, and 4750 transferred before the dispute.
        releasedCents: 21797 + 9500 + 4750,
        // paid_held 9500, in_progress 19000, delivered 28500 - 3000 refunded,
        // disputed before release 3800. Refunded, cancelled and
        // pending_payment are excluded; the post-release dispute is released.
        heldCents: 9500 + 19000 + 25500 + 3800,
      },
      { currency: 'USD', releasedCents: 1900, heldCents: 7600 },
    ]);
  });

  it('never counts another photographer bookings', async () => {
    const earnings = await mainEarnings();
    const bookingIds = earnings.recent.map((entry) => entry.bookingId);
    expect(bookingIds).not.toContain(ids.otherReleased);
    expect(bookingIds).not.toContain(ids.otherHeld);

    const response = await getEarnings(other.token);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      totals: [{ currency: 'EUR', releasedCents: 95000, heldCents: 47500 }],
      recent: [
        {
          bookingId: ids.otherReleased,
          amountCents: 95000,
          currency: 'EUR',
          occurredAt: expect.any(String) as string,
        },
      ],
    });
  });

  it('lists bookings with a transfer or reversal, net amount, newest entry first', async () => {
    const earnings = await mainEarnings();
    expect(
      earnings.recent.map(({ bookingId, amountCents, currency }) => ({
        bookingId,
        amountCents,
        currency,
      })),
    ).toEqual([
      { bookingId: ids.usdReleased, amountCents: 1900, currency: 'USD' },
      { bookingId: ids.released, amountCents: 9500, currency: 'EUR' },
      { bookingId: ids.releasedThenPartlyReversed, amountCents: 21797, currency: 'EUR' },
      { bookingId: ids.disputedAfterRelease, amountCents: 4750, currency: 'EUR' },
    ]);
    const reversed = earnings.recent.find(
      (entry) => entry.bookingId === ids.releasedThenPartlyReversed,
    );
    expect(Date.parse(reversed?.occurredAt ?? '')).toBeGreaterThan(at(31).getTime());
  });

  it('caps recent at 20 bookings, newest first', async () => {
    const busy = await createPhotographer('busy');
    for (let index = 0; index < 21; index += 1) {
      await seedBooking(busy, client.id, {
        status: 'released',
        subtotalCents: 1000,
        platformFeeCents: 50,
        ledger: [{ type: 'transfer', amountCents: -950, occurredAt: at(100 - index) }],
      });
    }
    const response = await getEarnings(busy.token);
    expect(response.statusCode).toBe(200);
    const earnings = EarningsResponseSchema.parse(response.json());
    expect(earnings.recent).toHaveLength(20);
    expect(earnings.totals).toEqual([{ currency: 'EUR', releasedCents: 21 * 950, heldCents: 0 }]);
    const times = earnings.recent.map((entry) => Date.parse(entry.occurredAt));
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });
});
