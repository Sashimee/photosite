import { randomUUID } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createPrismaClient, type PrismaClient } from '@photoo/db';
import type { AdminDashboardSchema, AdminPermission } from '@photoo/shared';
import { Redis } from 'ioredis';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { z } from 'zod';
import { createTestApp } from '../../testing/create-test-app.js';
import { waitForLinkInEmail } from '../../testing/mailpit.js';
import { requireIntegrationEnv } from '../../testing/require-integration-env.js';
import { generateTotpCode } from '../../testing/totp.js';
import { TEST_ENV } from '../../testing/test-env.js';

const testEnv = requireIntegrationEnv(['TEST_DATABASE_URL', 'REDIS_URL']);
const PASSWORD = `photoo-test-${randomUUID()}`;
const FAKE_IP = '10.50.31.1';
const DAY_MS = 24 * 60 * 60 * 1000;
const RUN_ID = randomUUID().replaceAll('-', '').slice(0, 10);
const CURRENCY_A = 'XTS';
const CURRENCY_B = 'XXX';

type Dashboard = z.infer<typeof AdminDashboardSchema>;
type DashboardMoney = NonNullable<Dashboard['money']>;
type AdminHeaders = Record<string, string>;

interface Flat {
  total: number;
  client: number;
  photographer: number;
  professional: number;
  requests: number;
  quotes: number;
  bookings: number;
}

interface Counts {
  signups: Dashboard['signups'];
  activity: Dashboard['activity'];
  backlogs: Dashboard['backlogs'];
}

describe('admin dashboard integration', () => {
  if (!testEnv) {
    it.skip('skipped: TEST_DATABASE_URL or REDIS_URL is not set', () => undefined);
    return;
  }

  let app: NestFastifyApplication;
  let prisma: PrismaClient;
  let redis: Redis;
  const createdUserIds: string[] = [];
  const createdBookingIds: string[] = [];
  const createdProfileIds: string[] = [];
  const createdUploadIds: string[] = [];
  const createdReportIds: string[] = [];

  const productIdByProfile = new Map<string, string>();

  let moderator: AdminHeaders;
  let finance: AdminHeaders;
  let noGrants: AdminHeaders;

  // Date is faked only around each dashboard request so window edges are exact
  // while sessions, Redis and Postgres keep running on real time.
  const NOW = new Date(Math.floor(Date.now() / 1000) * 1000);
  const ago = (ms: number) => new Date(NOW.getTime() - ms);
  const daysAgo = (days: number) => ago(days * DAY_MS);

  function fastify() {
    return app.getHttpAdapter().getInstance();
  }

  function uniqueEmail(label: string): string {
    return `dashboard-${label}-${RUN_ID}-${randomUUID().slice(0, 8)}@photoo.test`;
  }

  function sessionCookieHeader(response: {
    cookies: { name: string; value: string }[];
  }): string | undefined {
    const cookie = response.cookies.find((candidate) => candidate.name === 'photoo_session');
    return cookie ? `${cookie.name}=${cookie.value}` : undefined;
  }

  function extractFragmentToken(link: string): string | null {
    const hashIndex = link.indexOf('#token=');
    if (hashIndex === -1) {
      return null;
    }
    return decodeURIComponent(link.slice(hashIndex + '#token='.length));
  }

  async function makeAdmin(
    label: string,
    permissions: readonly AdminPermission[],
  ): Promise<AdminHeaders> {
    const email = uniqueEmail(label);
    const signUpResponse = await fastify().inject({
      method: 'POST',
      url: '/v1/auth/sign-up',
      remoteAddress: FAKE_IP,
      payload: { email, password: PASSWORD, roles: ['client'], locale: 'en' },
    });
    const userId = signUpResponse.json<{ user: { id: string } }>().user.id;
    createdUserIds.push(userId);

    const link = await waitForLinkInEmail(email, /https?:\/\/\S*verify-email#token=\S+/);
    const token = extractFragmentToken(link);
    if (!token) {
      throw new Error(`no token found in verification link: ${link}`);
    }
    await fastify().inject({
      method: 'POST',
      url: '/v1/auth/verify-email',
      remoteAddress: FAKE_IP,
      payload: { token },
    });

    await prisma.user.update({ where: { id: userId }, data: { roles: ['admin'] } });
    for (const permission of permissions) {
      await prisma.adminPermissionGrant.create({
        data: { userId, permission, grantedByAdminId: userId },
      });
    }

    const signInResponse = await fastify().inject({
      method: 'POST',
      url: '/v1/auth/sign-in',
      remoteAddress: FAKE_IP,
      payload: { email, password: PASSWORD },
    });
    let cookie = sessionCookieHeader(signInResponse);
    if (!cookie) {
      throw new Error('expected a session cookie on sign-in');
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
    return { cookie, origin: 'http://localhost:3000' };
  }

  async function getDashboard(headers: AdminHeaders, query = '') {
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
    try {
      return await fastify().inject({
        method: 'GET',
        url: `/v1/admin/dashboard${query}`,
        headers,
      });
    } finally {
      vi.useRealTimers();
    }
  }

  async function loadDashboard(headers: AdminHeaders, window?: '7d' | '30d' | '90d') {
    const response = await getDashboard(headers, window ? `?window=${window}` : '');
    expect(response.statusCode).toBe(200);
    return response.json<Dashboard>();
  }

  async function createUser(label: string, roles: string[], createdAt: Date) {
    const user = await prisma.user.create({
      data: {
        email: uniqueEmail(label),
        emailVerifiedAt: new Date(),
        locale: 'en',
        countryCode: 'LU',
        roles: roles as never,
        createdAt,
      },
    });
    createdUserIds.push(user.id);
    return user;
  }

  async function createProfile(label: string) {
    const user = await createUser(`profile-${label}`, ['photographer'], daysAgo(400));
    const slug = `dash-${label}-${RUN_ID}`;
    const profile = await prisma.photographerProfile.create({
      data: {
        userId: user.id,
        slug,
        displayName: `Dashboard fixture ${label}`,
        bio: {},
        links: { other: [] },
        categories: ['portrait'],
        languages: ['en'],
        city: 'Luxembourg',
        countryCode: 'LU',
      },
    });
    createdProfileIds.push(profile.id);
    const product = await prisma.product.create({
      data: {
        profileId: profile.id,
        title: { en: 'Fixture shoot' },
        category: 'portrait',
        durationMinutes: 60,
        deliverables: [],
        basePriceCents: 10000,
        currency: 'EUR',
        order: 0,
      },
    });
    productIdByProfile.set(profile.id, product.id);
    return { user, profile };
  }

  async function createQuote(
    photographerId: string,
    clientId: string,
    status: 'draft' | 'sent' | 'accepted' | 'expired',
    createdAt: Date,
  ) {
    return prisma.quote.create({
      data: {
        photographerId,
        clientId,
        productId: requireProductId(photographerId),
        lineItems: [{ label: 'Coverage', qty: 1, unitCents: 10000 }],
        subtotalCents: 10000,
        platformFeeCents: 500,
        totalCents: 10000,
        feePercent: '5.00',
        licenceUsage: 'personal',
        currency: 'EUR',
        validUntil: daysAgo(-30),
        status,
        createdAt,
      },
    });
  }

  async function createBooking(
    photographerId: string,
    clientId: string,
    status: 'pending_payment' | 'paid_held' | 'released' | 'refunded' | 'cancelled',
    createdAt: Date,
  ) {
    const quote = await createQuote(photographerId, clientId, 'accepted', daysAgo(200));
    const booking = await prisma.booking.create({
      data: { quoteId: quote.id, clientId, photographerId, status, createdAt },
    });
    createdBookingIds.push(booking.id);
    return booking;
  }

  async function createPortfolioImageWithCheck(
    profileId: string,
    ownerId: string,
    status: 'pending_review' | 'approved' | 'flagged',
    order: number,
  ) {
    const upload = await prisma.upload.create({
      data: {
        ownerId,
        purpose: 'portfolio',
        status: 'processed',
        mimeType: 'image/jpeg',
        declaredSizeBytes: 1024,
        actualSizeBytes: 1024,
        objectKey: `fixtures/dashboard-${RUN_ID}/${String(order)}/original.jpg`,
        virusScanStatus: 'clean',
      },
    });
    createdUploadIds.push(upload.id);
    const image = await prisma.portfolioImage.create({
      data: { profileId, uploadId: upload.id, order, status },
    });
    await prisma.provenanceCheck.create({
      data: {
        portfolioImageId: image.id,
        aiVendor: 'vendor-x',
        reverseMatches: [],
        score: '0.5',
        verdict: 'review',
      },
    });
  }

  async function addLedger(
    bookingId: string,
    type: 'charge' | 'refund' | 'platform_fee' | 'transfer',
    amountCents: number,
    currency: string,
    occurredAt: Date,
  ) {
    await prisma.ledgerEntry.create({
      data: {
        bookingId,
        type,
        amountCents,
        currency,
        stripeObjectId: `${type}_${randomUUID()}`,
        occurredAt,
      },
    });
  }

  function requireProductId(profileId: string): string {
    const productId = productIdByProfile.get(profileId);
    if (!productId) {
      throw new Error(`no fixture product for profile ${profileId}`);
    }
    return productId;
  }

  function pickCounts(body: Dashboard): Counts {
    return { signups: body.signups, activity: body.activity, backlogs: body.backlogs };
  }

  function requireMoney(body: Dashboard): DashboardMoney {
    if (!body.money) {
      throw new Error('expected money in the dashboard response');
    }
    return body.money;
  }

  function moneyFor(rows: DashboardMoney['gmv'], currency: string) {
    return rows.find((row) => row.currency === currency);
  }

  async function clearRateLimitKeys(): Promise<void> {
    const patterns = [`rate-limit:auth:*:${FAKE_IP}`, `lockout:auth:*:${FAKE_IP}`];
    const globbed = (await Promise.all(patterns.map((pattern) => redis.keys(pattern)))).flat();
    if (globbed.length > 0) {
      await redis.del(...globbed);
    }
  }

  let baseline30: Counts;
  let baseline7: Counts;
  let after30: Dashboard;
  let after7: Dashboard;

  function delta(after: Counts, before: Counts): { current: Flat; previous: Flat } {
    const diff = (pick: (value: { current: number; previous: number }) => number): Flat => ({
      total: pick(after.signups.total) - pick(before.signups.total),
      client: pick(after.signups.client) - pick(before.signups.client),
      photographer: pick(after.signups.photographer) - pick(before.signups.photographer),
      professional: pick(after.signups.professional) - pick(before.signups.professional),
      requests: pick(after.activity.requests) - pick(before.activity.requests),
      quotes: pick(after.activity.quotes) - pick(before.activity.quotes),
      bookings: pick(after.activity.bookings) - pick(before.activity.bookings),
    });
    return { current: diff((value) => value.current), previous: diff((value) => value.previous) };
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

    moderator = await makeAdmin('moderator', ['moderation']);
    finance = await makeAdmin('finance', ['finance']);
    noGrants = await makeAdmin('no-grants', []);

    baseline30 = pickCounts(await loadDashboard(moderator, '30d'));
    baseline7 = pickCounts(await loadDashboard(moderator, '7d'));

    const { user: photographerUser, profile } = await createProfile('main');
    const client = await createUser('client', ['client'], daysAgo(400));

    await createUser('s-client', ['client'], daysAgo(1));
    await createUser('s-multi', ['client', 'photographer'], daysAgo(2));
    await createUser('s-pro', ['professional'], daysAgo(3));
    await createUser('s-admin-only', ['admin'], daysAgo(1));
    await createUser('s-window-start', ['client'], daysAgo(30));
    await createUser('s-just-before-start', ['photographer'], ago(30 * DAY_MS + 1));
    await createUser('s-at-now', ['client'], NOW);
    await createUser('s-prev-start', ['client'], daysAgo(60));
    await createUser('s-before-prev-start', ['client'], ago(60 * DAY_MS + 1));
    await createUser('s-ten-days', ['client'], daysAgo(10));

    const requestBase = {
      clientId: client.id,
      title: `Dashboard fixture ${RUN_ID}`,
      category: 'portrait' as const,
      description: 'fixture',
      eventDate: daysAgo(-30),
      address: {},
      city: 'Luxembourg',
      countryCode: 'LU',
      budgetMinCents: 1000,
      budgetMaxCents: 5000,
      currency: 'EUR',
      usage: 'personal' as const,
      expiresAt: daysAgo(-60),
    };
    for (const createdAt of [daysAgo(1), daysAgo(30), daysAgo(45), ago(60 * DAY_MS + 1), NOW]) {
      await prisma.request.create({ data: { ...requestBase, createdAt } });
    }

    await createQuote(profile.id, client.id, 'sent', daysAgo(1));
    await createQuote(profile.id, client.id, 'draft', daysAgo(1));
    await createQuote(profile.id, client.id, 'accepted', daysAgo(2));
    await createQuote(profile.id, client.id, 'expired', daysAgo(40));

    const paid = await createBooking(profile.id, client.id, 'paid_held', daysAgo(1));
    await createBooking(profile.id, client.id, 'released', daysAgo(3));
    await createBooking(profile.id, client.id, 'paid_held', daysAgo(30));
    await createBooking(profile.id, client.id, 'refunded', daysAgo(40));
    await createBooking(profile.id, client.id, 'pending_payment', daysAgo(1));
    await createBooking(profile.id, client.id, 'cancelled', daysAgo(1));

    await addLedger(paid.id, 'charge', 10000, CURRENCY_A, daysAgo(1));
    await addLedger(paid.id, 'charge', 2500, CURRENCY_A, daysAgo(2));
    await addLedger(paid.id, 'charge', 30, CURRENCY_A, daysAgo(30));
    await addLedger(paid.id, 'charge', 700, CURRENCY_B, daysAgo(3));
    await addLedger(paid.id, 'charge', 4000, CURRENCY_A, daysAgo(40));
    await addLedger(paid.id, 'charge', 5, CURRENCY_A, daysAgo(60));
    await addLedger(paid.id, 'charge', 111, CURRENCY_A, NOW);
    await addLedger(paid.id, 'charge', 1, CURRENCY_A, ago(60 * DAY_MS + 1));
    await addLedger(paid.id, 'refund', -1500, CURRENCY_A, daysAgo(1));
    await addLedger(paid.id, 'refund', -250, CURRENCY_A, daysAgo(45));
    await addLedger(paid.id, 'platform_fee', -500, CURRENCY_A, daysAgo(1));
    await addLedger(paid.id, 'platform_fee', -125, CURRENCY_A, daysAgo(2));
    await addLedger(paid.id, 'transfer', 9500, CURRENCY_A, daysAgo(1));

    for (const status of ['draft', 'submitted', 'in_review', 'approved', 'rejected'] as const) {
      const subject = await createUser(`vc-${status}`, ['photographer'], daysAgo(400));
      await prisma.verificationCase.create({
        data: { userId: subject.id, countryCode: 'LU', status },
      });
    }

    await createPortfolioImageWithCheck(profile.id, photographerUser.id, 'pending_review', 1);
    await createPortfolioImageWithCheck(profile.id, photographerUser.id, 'approved', 2);
    await createPortfolioImageWithCheck(profile.id, photographerUser.id, 'flagged', 3);

    for (const status of ['open', 'resolved', 'dismissed'] as const) {
      const report = await prisma.report.create({
        data: { targetType: 'user', targetId: client.id, reason: `fixture ${RUN_ID}`, status },
      });
      createdReportIds.push(report.id);
    }

    for (const status of [
      'pending',
      'processing',
      'failed',
      'ready',
      'completed',
      'cancelled',
    ] as const) {
      const subject = await createUser(`dr-${status}`, ['client'], daysAgo(400));
      await prisma.dataRequest.create({ data: { userId: subject.id, type: 'export', status } });
    }

    after30 = await loadDashboard(moderator, '30d');
    after7 = await loadDashboard(moderator, '7d');
  });

  afterEach(async () => {
    await clearRateLimitKeys();
  });

  afterAll(async () => {
    await prisma.ledgerEntry.deleteMany({ where: { bookingId: { in: createdBookingIds } } });
    await prisma.booking.deleteMany({ where: { id: { in: createdBookingIds } } });
    await prisma.quote.deleteMany({ where: { photographerId: { in: createdProfileIds } } });
    await prisma.request.deleteMany({ where: { title: `Dashboard fixture ${RUN_ID}` } });
    await prisma.report.deleteMany({ where: { id: { in: createdReportIds } } });
    await prisma.portfolioImage.deleteMany({ where: { profileId: { in: createdProfileIds } } });
    await prisma.photographerProfile.deleteMany({ where: { id: { in: createdProfileIds } } });
    await prisma.upload.deleteMany({ where: { id: { in: createdUploadIds } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: createdUserIds } } });
    await prisma.adminPermissionGrant.deleteMany({
      where: { grantedByAdminId: { in: createdUserIds } },
    });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await prisma.$disconnect();
    redis.disconnect();
    await app.close();
  });

  describe('windows and buckets (30d)', () => {
    it('echoes the window and the request time', () => {
      expect(after30.window).toBe('30d');
      expect(after30.generatedAt).toBe(NOW.toISOString());
    });

    it('defaults to 30d when no window is given', async () => {
      const body = await loadDashboard(moderator);
      expect(body.window).toBe('30d');
    });

    it('counts sign-ups in the current and previous window, inclusive at the start and exclusive at now', () => {
      const { current, previous } = delta(pickCounts(after30), baseline30);
      expect(current).toMatchObject({ total: 5, client: 4, photographer: 1, professional: 1 });
      expect(previous).toMatchObject({ total: 2, client: 1, photographer: 1, professional: 0 });
    });

    it('counts a multi-role user in each of their roles but once in the total', () => {
      const { current } = delta(pickCounts(after30), baseline30);
      expect(current.client + current.photographer + current.professional).toBe(current.total + 1);
    });

    it('excludes admin-only users from every sign-up figure', () => {
      const { current } = delta(pickCounts(after30), baseline30);
      expect(current.total).toBe(5);
    });

    it('counts requests, non-draft quotes and paid bookings per window', () => {
      const { current, previous } = delta(pickCounts(after30), baseline30);
      expect(current).toMatchObject({ requests: 2, quotes: 2, bookings: 3 });
      expect(previous).toMatchObject({ requests: 1, quotes: 1, bookings: 1 });
    });

    it('counts backlogs from the right states only', () => {
      expect(after30.backlogs).toEqual({
        verification: baseline30.backlogs.verification + 2,
        provenance: baseline30.backlogs.provenance + 1,
        reports: baseline30.backlogs.reports + 1,
        dataRequests: baseline30.backlogs.dataRequests + 3,
      });
    });

    it('does not vary backlogs with the window', () => {
      expect(after7.backlogs).toEqual(after30.backlogs);
    });
  });

  describe('7d window', () => {
    it('shifts rows between the current and previous window', () => {
      const { current, previous } = delta(pickCounts(after7), baseline7);
      expect(current).toMatchObject({ total: 3, client: 2, photographer: 1, professional: 1 });
      expect(previous).toMatchObject({ total: 1, client: 1, photographer: 0, professional: 0 });
    });
  });

  describe('money', () => {
    it('is null for a moderation-only admin', () => {
      expect(after30.money).toBeNull();
    });

    it('is present for a finance admin and keeps currencies separate', async () => {
      const body = await loadDashboard(finance, '30d');
      expect(moneyFor(requireMoney(body).gmv, CURRENCY_A)).toEqual({
        currency: CURRENCY_A,
        current: 12530,
        previous: 4005,
      });
      expect(moneyFor(requireMoney(body).gmv, CURRENCY_B)).toEqual({
        currency: CURRENCY_B,
        current: 700,
        previous: 0,
      });
    });

    it('reports refunds and fee revenue as positive magnitudes and ignores other ledger types', async () => {
      const body = await loadDashboard(finance, '30d');
      expect(moneyFor(requireMoney(body).refunds, CURRENCY_A)).toEqual({
        currency: CURRENCY_A,
        current: 1500,
        previous: 250,
      });
      expect(moneyFor(requireMoney(body).feeRevenue, CURRENCY_A)).toEqual({
        currency: CURRENCY_A,
        current: 625,
        previous: 0,
      });
      expect(moneyFor(requireMoney(body).feeRevenue, CURRENCY_B)).toBeUndefined();
      expect(moneyFor(requireMoney(body).refunds, CURRENCY_B)).toBeUndefined();
    });

    it('only sums charges for the window asked', async () => {
      const body = await loadDashboard(finance, '7d');
      expect(moneyFor(requireMoney(body).gmv, CURRENCY_A)).toEqual({
        currency: CURRENCY_A,
        current: 12500,
        previous: 0,
      });
    });
  });

  describe('response content', () => {
    it('contains aggregates only, no seeded emails or ids', async () => {
      const response = await getDashboard(finance, '?window=30d');
      expect(response.body).not.toContain('@photoo.test');
      expect(response.body).not.toContain(RUN_ID);
      expect(Object.keys(response.json<Dashboard>()).sort()).toEqual([
        'activity',
        'backlogs',
        'generatedAt',
        'money',
        'signups',
        'window',
      ]);
    });
  });

  describe('access and validation', () => {
    it('returns 401 when unauthenticated', async () => {
      const response = await getDashboard({ origin: 'http://localhost:3000' });
      expect(response.statusCode).toBe(401);
    });

    it('returns 403 for an admin with no permission grants', async () => {
      const response = await getDashboard(noGrants);
      expect(response.statusCode).toBe(403);
    });

    it.each(['14d', '', '0d', '30D', 'abc'])('returns 400 for window=%j', async (window) => {
      const response = await getDashboard(finance, `?window=${encodeURIComponent(window)}`);
      expect(response.statusCode).toBe(400);
    });
  });
});
