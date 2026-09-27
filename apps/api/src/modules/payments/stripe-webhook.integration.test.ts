import { randomUUID } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createPrismaClient, type PrismaClient } from '@photoo/db';
import { Redis } from 'ioredis';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../../testing/create-test-app.js';
import { waitForLinkInEmail } from '../../testing/mailpit.js';
import { requireIntegrationEnv } from '../../testing/require-integration-env.js';
import { TEST_ENV } from '../../testing/test-env.js';
import { generateTotpCode } from '../../testing/totp.js';
import { stripeDisputeReason } from './booking-money-events.service.js';
import { BookingReleaseService } from './booking-release.service.js';
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
  ): Promise<{ token: string; id: string; email: string; cookie: string | undefined }> {
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
    return {
      token: body.session.token,
      id: body.user.id,
      email,
      cookie: sessionCookieHeader(signInResponse),
    };
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

  async function paidBooking(label: string) {
    const booking = await paymentIntentFor(label);
    const event = paymentIntentEvent('payment_intent.succeeded', booking.paymentIntentId);
    expect((await sendEvent(event)).statusCode).toBe(200);
    const { chargeId } = await prisma.booking.findUniqueOrThrow({
      where: { id: booking.bookingId },
      select: { chargeId: true },
    });
    if (chargeId === null) {
      throw new Error('payment_intent.succeeded did not store a charge id');
    }
    gateway().linkCharge(chargeId, booking.paymentIntentId);
    return { ...booking, chargeId };
  }

  async function releasedBooking(label: string) {
    const booking = await paidBooking(label);
    const account = await gateway().createConnectedAccount({
      country: 'LU',
      metadata: {},
      idempotencyKey: `it_account_${booking.bookingId}`,
    });
    await prisma.photographerProfile.update({
      where: { id: booking.photographer.profileId },
      data: { stripeAccountId: account.id },
    });
    await prisma.booking.update({
      where: { id: booking.bookingId },
      data: { status: 'delivered', releaseDueAt: new Date(Date.now() - 60 * 1000) },
    });
    const outcome = await app
      .get(BookingReleaseService)
      .release(booking.bookingId, { type: 'system', id: null });
    if (outcome.status !== 'released') {
      throw new Error(`release of ${booking.bookingId} was ${outcome.status}`);
    }
    return { ...booking, transferId: outcome.transferId, payoutCents: outcome.amountCents };
  }

  async function dashboardRefund(booking: { paymentIntentId: string }, amountCents: number) {
    return gateway().createRefund({
      paymentIntentId: booking.paymentIntentId,
      amountCents,
      metadata: {},
      idempotencyKey: `it_dashboard_${randomUUID()}`,
    });
  }

  function chargeRefundedEvent(
    booking: { chargeId: string; paymentIntentId: string },
    amountRefunded: number,
  ) {
    return {
      id: `evt_it_${randomUUID()}`,
      object: 'event',
      type: 'charge.refunded',
      livemode: false,
      data: {
        object: {
          id: booking.chargeId,
          object: 'charge',
          payment_intent: booking.paymentIntentId,
          amount: 25050,
          amount_refunded: amountRefunded,
          refunded: amountRefunded === 25050,
          currency: 'eur',
        },
      },
    };
  }

  function disputeEvent(
    type: 'charge.dispute.created' | 'charge.dispute.closed',
    dispute: { id: string; chargeId: string; status: string; amount?: number },
  ) {
    return {
      id: `evt_it_${randomUUID()}`,
      object: 'event',
      type,
      livemode: false,
      data: {
        object: {
          id: dispute.id,
          object: 'dispute',
          charge: dispute.chargeId,
          amount: dispute.amount ?? 25050,
          currency: 'eur',
          reason: 'fraudulent',
          status: dispute.status,
        },
      },
    };
  }

  function transferReversedEvent(
    transferId: string,
    amount: number,
    reversals: readonly { id: string; amount: number }[],
  ) {
    return {
      id: `evt_it_${randomUUID()}`,
      object: 'event',
      type: 'transfer.reversed',
      livemode: false,
      data: {
        object: {
          id: transferId,
          object: 'transfer',
          amount,
          amount_reversed: reversals.reduce((sum, reversal) => sum + reversal.amount, 0),
          currency: 'eur',
          reversals: {
            object: 'list',
            data: reversals.map((reversal) => ({ ...reversal, object: 'transfer_reversal' })),
          },
        },
      },
    };
  }

  function sessionCookieHeader(response: {
    cookies: { name: string; value: string }[];
  }): string | undefined {
    const cookie = response.cookies.find((candidate) => candidate.name === 'photoo_session');
    return cookie ? `${cookie.name}=${cookie.value}` : undefined;
  }

  async function adminWithTwoFactor(label: string, finance: boolean) {
    const admin = await signUpAndSignIn(`admin-${label}`, ['client']);
    await prisma.user.update({ where: { id: admin.id }, data: { roles: ['admin'] } });
    if (finance) {
      await prisma.adminPermissionGrant.create({
        data: { userId: admin.id, permission: 'finance', grantedByAdminId: admin.id },
      });
    }

    let cookie = admin.cookie;
    if (!cookie) {
      throw new Error('expected a session cookie on admin sign-in');
    }
    const enrollResponse = await fastify().inject({
      method: 'POST',
      url: '/v1/auth/totp/enroll',
      headers: { cookie, origin: 'http://localhost:3000' },
      payload: { password: PASSWORD },
    });
    const { secret } = enrollResponse.json<{ secret: string }>();
    const verifyResponse = await fastify().inject({
      method: 'POST',
      url: '/v1/auth/totp/verify',
      headers: { cookie, origin: 'http://localhost:3000' },
      payload: { code: generateTotpCode(secret) },
    });
    cookie = sessionCookieHeader(verifyResponse) ?? cookie;
    return { id: admin.id, headers: { cookie, origin: 'http://localhost:3000' } };
  }

  function bookingAuditCount(bookingId: string, action: string) {
    return prisma.auditLog.count({ where: { targetType: 'Booking', targetId: bookingId, action } });
  }

  function ledgerOf(bookingId: string) {
    return prisma.ledgerEntry.findMany({
      where: { bookingId },
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
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
      await prisma.auditLog.deleteMany({
        where: {
          OR: [
            { targetType: 'Booking', targetId: { in: bookingIds } },
            { actorId: { in: createdUserIds } },
          ],
        },
      });
      await prisma.dispute.deleteMany({ where: { bookingId: { in: bookingIds } } });
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

    it('records, audits and refunds a late payment on a cancelled booking, once', async () => {
      const { bookingId, paymentIntentId, quote } = await paymentIntentFor('cancelled');
      await prisma.booking.update({ where: { id: bookingId }, data: { status: 'cancelled' } });
      const event = paymentIntentEvent('payment_intent.succeeded', paymentIntentId);

      const response = await sendEvent(event);

      expect(response.statusCode).toBe(200);
      const booking = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
      expect(booking.status).toBe('cancelled');
      expect(booking.chargeId).toBeNull();
      const ledger = await prisma.ledgerEntry.findMany({
        where: { bookingId },
        orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
      });
      expect(ledger.map((entry) => [entry.type, entry.amountCents])).toEqual([
        ['charge', quote.total.amountCents],
        ['refund', -quote.total.amountCents],
      ]);
      expect(ledger.reduce((sum, entry) => sum + entry.amountCents, 0)).toBe(0);
      const auditWhere = {
        targetType: 'Booking',
        targetId: bookingId,
        action: 'booking.paid_after_terminal',
      };
      expect(await prisma.auditLog.count({ where: auditWhere })).toBe(1);
      const refundAuditWhere = { ...auditWhere, action: 'booking.late_payment_refunded' };
      const refundAudit = await prisma.auditLog.findFirstOrThrow({ where: refundAuditWhere });
      expect(refundAudit.after).toEqual({
        status: 'cancelled',
        refundId: ledger[1]?.stripeObjectId,
        amountCents: quote.total.amountCents,
      });
      expect((await storedEvent(event.id))?.processedAt).not.toBeNull();

      await sendEvent(event);
      expect(await prisma.ledgerEntry.count({ where: { bookingId } })).toBe(2);
      expect(await prisma.auditLog.count({ where: auditWhere })).toBe(1);
      expect(await prisma.auditLog.count({ where: refundAuditWhere })).toBe(1);
    });

    it('pays against the stored fee snapshot even when it differs from the current rate', async () => {
      const { bookingId, paymentIntentId, quote } = await paymentIntentFor('fee');
      await prisma.quote.update({ where: { id: quote.id }, data: { platformFeeCents: 1252 } });
      const event = paymentIntentEvent('payment_intent.succeeded', paymentIntentId);

      const response = await sendEvent(event);

      expect(response.statusCode).toBe(200);
      const booking = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
      expect(booking.status).toBe('paid_held');
      expect((await storedEvent(event.id))?.processedAt).not.toBeNull();
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

    it('records and acks an event type it does not handle, leaving it replayable', async () => {
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
      expect(stored?.processedAt).toBeNull();
    });
  });

  describe('refund, reversal and dispute webhooks', () => {
    it('records a full charge.refunded once and moves the booking to refunded', async () => {
      const booking = await paidBooking('refund-full');
      const dashboard = await dashboardRefund(booking, 25050);
      const event = chargeRefundedEvent(booking, 25050);

      expect((await sendEvent(event)).statusCode).toBe(200);
      expect((await sendEvent(event)).statusCode).toBe(200);

      const refunds = (await ledgerOf(booking.bookingId)).filter((row) => row.type === 'refund');
      expect(refunds.map((row) => [row.stripeObjectId, row.amountCents])).toEqual([
        [dashboard.id, -25050],
      ]);
      const stored = await prisma.booking.findUniqueOrThrow({ where: { id: booking.bookingId } });
      expect(stored.status).toBe('refunded');
      expect(await bookingAuditCount(booking.bookingId, 'booking.refund_recorded')).toBe(1);
      expect((await storedEvent(event.id))?.processedAt).not.toBeNull();
    });

    it('keeps a partially refunded booking in paid_held', async () => {
      const booking = await paidBooking('refund-partial');
      const dashboard = await dashboardRefund(booking, 5000);
      const event = chargeRefundedEvent(booking, 5000);

      expect((await sendEvent(event)).statusCode).toBe(200);

      const stored = await prisma.booking.findUniqueOrThrow({ where: { id: booking.bookingId } });
      expect(stored.status).toBe('paid_held');
      const refunds = (await ledgerOf(booking.bookingId)).filter((row) => row.type === 'refund');
      expect(refunds.map((row) => [row.stripeObjectId, row.amountCents])).toEqual([
        [dashboard.id, -5000],
      ]);
    });

    it('lists refunds for a real-shaped charge.refunded that carries no refunds field', async () => {
      const booking = await paidBooking('refund-real-shape');
      const first = await dashboardRefund(booking, 10000);
      const partialEvent = chargeRefundedEvent(booking, 10000);
      expect(partialEvent.data.object).not.toHaveProperty('refunds');

      expect((await sendEvent(partialEvent)).statusCode).toBe(200);

      const afterPartial = await prisma.booking.findUniqueOrThrow({
        where: { id: booking.bookingId },
      });
      expect(afterPartial.status).toBe('paid_held');

      const second = await dashboardRefund(booking, 15050);
      const fullEvent = chargeRefundedEvent(booking, 25050);
      expect((await sendEvent(fullEvent)).statusCode).toBe(200);
      expect((await sendEvent(fullEvent)).statusCode).toBe(200);

      const refunds = (await ledgerOf(booking.bookingId)).filter((row) => row.type === 'refund');
      expect(
        refunds
          .map((row) => [row.stripeObjectId, row.amountCents])
          .sort(([a], [b]) => String(a).localeCompare(String(b))),
      ).toEqual(
        [
          [first.id, -10000],
          [second.id, -15050],
        ].sort(([a], [b]) => String(a).localeCompare(String(b))),
      );
      const stored = await prisma.booking.findUniqueOrThrow({ where: { id: booking.bookingId } });
      expect(stored.status).toBe('refunded');
      expect(await bookingAuditCount(booking.bookingId, 'booking.refund_recorded')).toBe(2);
      expect(await bookingAuditCount(booking.bookingId, 'booking.refund_unreconciled')).toBe(0);
      expect((await storedEvent(partialEvent.id))?.processedAt).not.toBeNull();
      expect((await storedEvent(fullEvent.id))?.processedAt).not.toBeNull();
    });

    it('stores and defers a charge.refunded whose refunds cannot be listed', async () => {
      const booking = await paidBooking('refund-list-fails');
      const event = chargeRefundedEvent(
        { ...booking, chargeId: `ch_it_unknown_${randomUUID()}` },
        25050,
      );

      expect((await sendEvent(event)).statusCode).toBe(200);

      const stored = await storedEvent(event.id);
      expect(stored?.type).toBe('charge.refunded');
      expect(stored?.processedAt).toBeNull();
      expect(
        (await ledgerOf(booking.bookingId)).filter((row) => row.type === 'refund'),
      ).toHaveLength(0);
      const unchanged = await prisma.booking.findUniqueOrThrow({
        where: { id: booking.bookingId },
      });
      expect(unchanged.status).toBe('paid_held');
    });

    it('freezes the booking on a dispute, notifies finance and restores it when won', async () => {
      const admin = await adminWithTwoFactor('dispute-won', true);
      const booking = await paidBooking('dispute-won');
      const disputeId = `dp_it_${randomUUID()}`;
      const created = disputeEvent('charge.dispute.created', {
        id: disputeId,
        chargeId: booking.chargeId,
        status: 'needs_response',
      });

      expect((await sendEvent(created)).statusCode).toBe(200);
      expect((await sendEvent(created)).statusCode).toBe(200);

      const disputed = await prisma.booking.findUniqueOrThrow({ where: { id: booking.bookingId } });
      expect(disputed.status).toBe('disputed');
      const disputes = await prisma.dispute.findMany({ where: { bookingId: booking.bookingId } });
      expect(disputes).toHaveLength(1);
      expect(disputes[0]?.status).toBe('open');
      expect(disputes[0]?.reason).toBe(stripeDisputeReason(disputeId, 'fraudulent'));
      const notifications = await prisma.notification.findMany({
        where: { userId: admin.id, type: 'dispute_opened' },
      });
      expect(notifications).toHaveLength(1);
      expect(notifications[0]?.payload).toMatchObject({
        total: { amountCents: 25050, currency: 'EUR' },
      });

      const closed = disputeEvent('charge.dispute.closed', {
        id: disputeId,
        chargeId: booking.chargeId,
        status: 'won',
      });
      expect((await sendEvent(closed)).statusCode).toBe(200);

      const restored = await prisma.booking.findUniqueOrThrow({ where: { id: booking.bookingId } });
      expect(restored.status).toBe('paid_held');
      const won = await prisma.dispute.findFirstOrThrow({
        where: { bookingId: booking.bookingId },
      });
      expect(won.status).toBe('won');
      expect(won.amountRefundedCents).toBe(0);
    });

    it('refuses to release a disputed booking and resumes the release once the dispute is won', async () => {
      const booking = await paidBooking('dispute-release');
      const account = await gateway().createConnectedAccount({
        country: 'LU',
        metadata: {},
        idempotencyKey: `it_account_${booking.bookingId}`,
      });
      await prisma.photographerProfile.update({
        where: { id: booking.photographer.profileId },
        data: { stripeAccountId: account.id },
      });
      await prisma.booking.update({
        where: { id: booking.bookingId },
        data: { status: 'delivered', releaseDueAt: new Date(Date.now() - 60 * 1000) },
      });

      const disputeId = `dp_it_${randomUUID()}`;
      const created = disputeEvent('charge.dispute.created', {
        id: disputeId,
        chargeId: booking.chargeId,
        status: 'needs_response',
      });
      expect((await sendEvent(created)).statusCode).toBe(200);
      const disputed = await prisma.booking.findUniqueOrThrow({ where: { id: booking.bookingId } });
      expect(disputed.status).toBe('disputed');

      const releaseService = app.get(BookingReleaseService);
      const refused = await releaseService.release(booking.bookingId, { type: 'system', id: null });
      expect(refused).toEqual({ status: 'skipped', reason: 'disputed' });
      const stillDisputed = await prisma.booking.findUniqueOrThrow({
        where: { id: booking.bookingId },
      });
      expect(stillDisputed.status).toBe('disputed');
      expect(stillDisputed.transferId).toBeNull();
      expect(
        (await ledgerOf(booking.bookingId)).filter((row) => row.type === 'transfer'),
      ).toHaveLength(0);

      const closed = disputeEvent('charge.dispute.closed', {
        id: disputeId,
        chargeId: booking.chargeId,
        status: 'won',
      });
      expect((await sendEvent(closed)).statusCode).toBe(200);
      const restored = await prisma.booking.findUniqueOrThrow({ where: { id: booking.bookingId } });
      expect(restored.status).toBe('delivered');

      const released = await releaseService.release(booking.bookingId, {
        type: 'system',
        id: null,
      });
      expect(released).toMatchObject({
        status: 'released',
        amountCents: expect.any(Number) as unknown,
      });
      const finalBooking = await prisma.booking.findUniqueOrThrow({
        where: { id: booking.bookingId },
      });
      expect(finalBooking.status).toBe('released');
      expect(finalBooking.transferId).not.toBeNull();
      expect(
        (await ledgerOf(booking.bookingId)).filter((row) => row.type === 'transfer'),
      ).toHaveLength(1);
    });

    it('keeps the booking disputed when the dispute is lost', async () => {
      const booking = await paidBooking('dispute-lost');
      const disputeId = `dp_it_${randomUUID()}`;
      await sendEvent(
        disputeEvent('charge.dispute.created', {
          id: disputeId,
          chargeId: booking.chargeId,
          status: 'needs_response',
        }),
      );

      const closed = disputeEvent('charge.dispute.closed', {
        id: disputeId,
        chargeId: booking.chargeId,
        status: 'lost',
      });
      expect((await sendEvent(closed)).statusCode).toBe(200);

      const stored = await prisma.booking.findUniqueOrThrow({ where: { id: booking.bookingId } });
      expect(stored.status).toBe('disputed');
      const lost = await prisma.dispute.findFirstOrThrow({
        where: { bookingId: booking.bookingId },
      });
      expect(lost.status).toBe('lost');
      expect(lost.amountRefundedCents).toBe(25050);
    });

    it('opens and closes a dispute whose closed event arrives before its created event', async () => {
      const booking = await paidBooking('dispute-out-of-order');
      const disputeId = `dp_it_${randomUUID()}`;

      const closed = disputeEvent('charge.dispute.closed', {
        id: disputeId,
        chargeId: booking.chargeId,
        status: 'lost',
      });
      expect((await sendEvent(closed)).statusCode).toBe(200);
      const created = disputeEvent('charge.dispute.created', {
        id: disputeId,
        chargeId: booking.chargeId,
        status: 'needs_response',
      });
      expect((await sendEvent(created)).statusCode).toBe(200);

      const disputes = await prisma.dispute.findMany({ where: { bookingId: booking.bookingId } });
      expect(disputes.map((dispute) => dispute.status)).toEqual(['lost']);
      const stored = await prisma.booking.findUniqueOrThrow({ where: { id: booking.bookingId } });
      expect(stored.status).toBe('disputed');
      expect((await storedEvent(created.id))?.processedAt).not.toBeNull();
    });

    it('records a transfer.reversed on a released booking once', async () => {
      const booking = await releasedBooking('reversed');
      const reversalId = `trr_it_${randomUUID()}`;
      const event = transferReversedEvent(booking.transferId, booking.payoutCents, [
        { id: reversalId, amount: 3000 },
      ]);

      expect((await sendEvent(event)).statusCode).toBe(200);
      expect((await sendEvent(event)).statusCode).toBe(200);

      const reversals = (await ledgerOf(booking.bookingId)).filter(
        (row) => row.type === 'reversal',
      );
      expect(reversals.map((row) => [row.stripeObjectId, row.amountCents])).toEqual([
        [reversalId, 3000],
      ]);
      const stored = await prisma.booking.findUniqueOrThrow({ where: { id: booking.bookingId } });
      expect(stored.status).toBe('released');
    });

    it('backfills a stored dispute event older than the sweep window', async () => {
      const booking = await paidBooking('dispute-backfill');
      const event = disputeEvent('charge.dispute.created', {
        id: `dp_it_${randomUUID()}`,
        chargeId: booking.chargeId,
        status: 'needs_response',
      });
      eventIds.push(event.id);
      await prisma.stripeEvent.create({
        data: {
          id: event.id,
          type: event.type,
          receivedAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000),
          processedAt: null,
          payload: event,
        },
      });

      const result = await app.get(StripeEventSweepService).sweep();

      expect(result.processed).toBeGreaterThanOrEqual(1);
      const stored = await prisma.booking.findUniqueOrThrow({ where: { id: booking.bookingId } });
      expect(stored.status).toBe('disputed');
      expect((await storedEvent(event.id))?.processedAt).not.toBeNull();
    });
  });

  describe('POST /v1/bookings/:id/refund', () => {
    function refund(bookingId: string, token: string, payload: Record<string, unknown>) {
      return fastify().inject({
        method: 'POST',
        url: `/v1/bookings/${bookingId}/refund`,
        remoteAddress: FAKE_IP,
        headers: headers(token),
        payload: { reason: 'Shoot cancelled', ...payload },
      });
    }

    it('refunds in parts before release and ignores the echoing webhook', async () => {
      const booking = await paidBooking('client-refund');

      const byPhotographer = await refund(booking.bookingId, booking.photographer.token, {});
      expect(byPhotographer.statusCode).toBe(403);
      const tooMuch = await refund(booking.bookingId, booking.client.token, { amountCents: 25051 });
      expect(tooMuch.statusCode).toBe(422);

      const partial = await refund(booking.bookingId, booking.client.token, { amountCents: 5000 });
      expect(partial.statusCode).toBe(200);
      expect(partial.json()).toMatchObject({
        status: 'partially_refunded',
        amount: { amountCents: 5000, currency: 'EUR' },
        refundedTotal: { amountCents: 5000, currency: 'EUR' },
        booking: { status: 'paid_held' },
      });

      const rest = await refund(booking.bookingId, booking.client.token, {});
      expect(rest.statusCode).toBe(200);
      expect(rest.json()).toMatchObject({
        status: 'refunded',
        amount: { amountCents: 20050, currency: 'EUR' },
        refundedTotal: { amountCents: 25050, currency: 'EUR' },
        booking: { status: 'refunded' },
      });

      const again = await refund(booking.bookingId, booking.client.token, { amountCents: 1 });
      expect(again.statusCode).toBe(409);

      const refunds = (await ledgerOf(booking.bookingId)).filter((row) => row.type === 'refund');
      expect(refunds.map((row) => row.amountCents)).toEqual([-5000, -20050]);
      const echo = chargeRefundedEvent(booking, 25050);
      expect((await sendEvent(echo)).statusCode).toBe(200);
      expect(
        (await ledgerOf(booking.bookingId)).filter((row) => row.type === 'refund'),
      ).toHaveLength(2);
      expect(await bookingAuditCount(booking.bookingId, 'booking.refund_recorded')).toBe(0);
      expect(await bookingAuditCount(booking.bookingId, 'booking.refund_partial')).toBe(1);
      expect(await bookingAuditCount(booking.bookingId, 'booking.refunded')).toBe(1);
    });

    it.each([0, -1, 1.5])('rejects an amountCents of %s with 400', async (amountCents) => {
      const booking = await paidBooking('refund-bad-amount');

      const response = await refund(booking.bookingId, booking.client.token, { amountCents });

      expect(response.statusCode).toBe(400);
      const stored = await prisma.booking.findUniqueOrThrow({ where: { id: booking.bookingId } });
      expect(stored.status).toBe('paid_held');
    });

    it('returns 404 when a stranger requests a refund on someone else’s booking', async () => {
      const booking = await paidBooking('refund-stranger');
      const stranger = await signUpAndSignIn('refund-stranger-caller', ['client']);

      const response = await refund(booking.bookingId, stranger.token, {});

      expect(response.statusCode).toBe(404);
    });

    it('returns 409 when the client refunds a booking that has already been released', async () => {
      const booking = await releasedBooking('refund-after-release');

      const response = await refund(booking.bookingId, booking.client.token, {});

      expect(response.statusCode).toBe(409);
    });
  });

  describe('admin booking refunds', () => {
    function adminPost(
      admin: { headers: Record<string, string> },
      bookingId: string,
      action: 'refund' | 'reverse-transfer',
      payload: Record<string, unknown>,
    ) {
      return fastify().inject({
        method: 'POST',
        url: `/v1/admin/bookings/${bookingId}/${action}`,
        remoteAddress: FAKE_IP,
        headers: admin.headers,
        payload: { reason: 'Photographer no-show confirmed', ...payload },
      });
    }

    it('reads bookings only with the finance permission', async () => {
      const booking = await paidBooking('admin-read');
      const plain = await adminWithTwoFactor('read-plain', false);
      const finance = await adminWithTwoFactor('read-finance', true);

      const forbidden = await fastify().inject({
        method: 'GET',
        url: `/v1/admin/bookings/${booking.bookingId}`,
        remoteAddress: FAKE_IP,
        headers: plain.headers,
      });
      expect(forbidden.statusCode).toBe(403);

      const allowed = await fastify().inject({
        method: 'GET',
        url: `/v1/admin/bookings/${booking.bookingId}`,
        remoteAddress: FAKE_IP,
        headers: finance.headers,
      });
      expect(allowed.statusCode).toBe(200);
      expect(allowed.json()).toMatchObject({
        id: booking.bookingId,
        status: 'paid_held',
        paymentIntentId: booking.paymentIntentId,
        chargeId: booking.chargeId,
        transferId: null,
        refundedCents: 0,
        reversedCents: 0,
        disputeStatus: null,
      });

      const list = await fastify().inject({
        method: 'GET',
        url: '/v1/admin/bookings',
        remoteAddress: FAKE_IP,
        headers: plain.headers,
      });
      expect(list.statusCode).toBe(403);
    });

    it('refuses admin money mutations before release', async () => {
      const admin = await adminWithTwoFactor('refund-held', true);
      const held = await paidBooking('admin-refund-held');

      const refunded = await adminPost(admin, held.bookingId, 'refund', { amountCents: 5000 });
      const reversed = await adminPost(admin, held.bookingId, 'reverse-transfer', {});

      expect(refunded.statusCode).toBe(409);
      expect(reversed.statusCode).toBe(409);
      expect((await ledgerOf(held.bookingId)).map((row) => row.type)).toEqual(['charge']);
    });

    it('reverses the transfer before refunding a released booking', async () => {
      const admin = await adminWithTwoFactor('refund', true);
      const booking = await releasedBooking('admin-refund');
      const refunded = await adminPost(admin, booking.bookingId, 'refund', { amountCents: 5000 });
      expect(refunded.statusCode).toBe(200);
      expect(refunded.json()).toMatchObject({
        status: 'released',
        transferId: booking.transferId,
        refundedCents: 5000,
        reversedCents: 5000,
      });
      const ledger = await ledgerOf(booking.bookingId);
      expect(
        ledger
          .filter((row) => row.type === 'reversal' || row.type === 'refund')
          .map((row) => [row.type, row.amountCents]),
      ).toEqual([
        ['reversal', 5000],
        ['refund', -5000],
      ]);

      const reversed = await adminPost(admin, booking.bookingId, 'reverse-transfer', {});
      expect(reversed.statusCode).toBe(200);
      expect(reversed.json()).toMatchObject({ reversedCents: booking.payoutCents });

      const nothingLeft = await adminPost(admin, booking.bookingId, 'refund', { amountCents: 1 });
      expect(nothingLeft.statusCode).toBe(422);
      const noTransferLeft = await adminPost(admin, booking.bookingId, 'reverse-transfer', {});
      expect(noTransferLeft.statusCode).toBe(422);
      expect(await bookingAuditCount(booking.bookingId, 'booking.refund_reversal')).toBe(1);
      expect(await bookingAuditCount(booking.bookingId, 'booking.admin_refund')).toBe(1);
      expect(await bookingAuditCount(booking.bookingId, 'booking.transfer_reversed')).toBe(1);
    });

    it('rejects a money mutation when the 2FA check is stale', async () => {
      const admin = await adminWithTwoFactor('stale', true);
      const booking = await releasedBooking('admin-stale');
      await prisma.session.updateMany({
        where: { userId: admin.id },
        data: { twoFactorVerifiedAt: new Date(Date.now() - 20 * 60 * 1000) },
      });

      const response = await adminPost(admin, booking.bookingId, 'refund', { amountCents: 1000 });

      expect(response.statusCode).toBe(403);
      expect(
        (await ledgerOf(booking.bookingId)).filter((row) => row.type !== 'charge'),
      ).toHaveLength(2);
    });
  });
});
