import { randomUUID } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createPrismaClient, type PrismaClient } from '@photoo/db';
import { PROVENANCE_CHECK_QUEUE_NAME, type AdminPermission } from '@photoo/shared';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../../testing/create-test-app.js';
import { waitForLinkInEmail } from '../../testing/mailpit.js';
import { requireIntegrationEnv } from '../../testing/require-integration-env.js';
import { generateTotpCode } from '../../testing/totp.js';
import { TEST_ENV } from '../../testing/test-env.js';

const testEnv = requireIntegrationEnv(['TEST_DATABASE_URL', 'REDIS_URL']);
const PASSWORD = `photoo-test-${randomUUID()}`;
const FAKE_IP = '10.50.23.1';

interface ProvenanceSummaryBody {
  id: string;
  portfolioImageId: string;
  portfolioImageStatus: string;
  thumbnailUrl: string;
  photographer: { id: string; displayName: string; slug: string };
  verdict: string;
  score: number | null;
  checkedAt: string | null;
  reviewedAt: string | null;
}

interface ProvenanceDetailBody extends ProvenanceSummaryBody {
  aiScore: number | null;
  aiVendor: string | null;
  reverseMatches: string[] | null;
  c2paValid: boolean | null;
  exifCamera: string | null;
  exifCapturedAt: string | null;
  reviewedByAdminId: string | null;
  note: string | null;
}

interface PageBody<T> {
  items: T[];
  nextCursor: string | null;
}

describe('admin provenance integration', () => {
  if (!testEnv) {
    it.skip('skipped: TEST_DATABASE_URL or REDIS_URL is not set', () => undefined);
    return;
  }

  let app: NestFastifyApplication;
  let prisma: PrismaClient;
  let redis: Redis;
  let provenanceQueueConnection: Redis;
  let provenanceQueue: Queue;
  const createdUserIds: string[] = [];

  function fastify() {
    return app.getHttpAdapter().getInstance();
  }

  function uniqueEmail(label: string): string {
    return `provenance-admin-${label}-${randomUUID()}@photoo.test`;
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

  async function signUpVerifyAndSignIn(label: string): Promise<{ id: string; email: string }> {
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

    return { id: userId, email };
  }

  async function makeAdmin(
    label: string,
    permissions: readonly AdminPermission[] = [],
  ): Promise<{ headers: { cookie: string; origin: string }; id: string; email: string }> {
    const admin = await signUpVerifyAndSignIn(label);
    await prisma.user.update({ where: { id: admin.id }, data: { roles: ['admin'] } });
    for (const permission of permissions) {
      await prisma.adminPermissionGrant.upsert({
        where: { userId_permission: { userId: admin.id, permission } },
        create: { userId: admin.id, permission, grantedByAdminId: admin.id },
        update: {},
      });
    }

    const signInResponse = await fastify().inject({
      method: 'POST',
      url: '/v1/auth/sign-in',
      remoteAddress: FAKE_IP,
      payload: { email: admin.email, password: PASSWORD },
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

    return {
      headers: { cookie, origin: 'http://localhost:3000' },
      id: admin.id,
      email: admin.email,
    };
  }

  function placeholderVariants(prefix: string): Record<string, string> {
    const variants: Record<string, string> = {};
    for (const name of ['thumb', 'medium', 'large']) {
      for (const [format, extension] of [
        ['jpeg', 'jpg'],
        ['webp', 'webp'],
      ] as const) {
        variants[`${name}_${format}`] = `v/${prefix}/${name}.${extension}`;
      }
    }
    return variants;
  }

  async function createFixtureCheck(
    label: string,
    overrides: {
      createdAt?: Date;
      verdict?: 'pass' | 'review' | 'fail';
      status?: 'processing' | 'pending_review' | 'approved' | 'flagged' | 'rejected';
      score?: string;
    } = {},
  ): Promise<{ id: string; portfolioImageId: string; profileId: string }> {
    const slug = `fx-provenance-${label}-${randomUUID().slice(0, 8)}`;
    const user = await prisma.user.create({
      data: {
        email: `${slug}@photoo.test`,
        emailVerifiedAt: new Date(),
        name: `Fixture ${label}`,
        locale: 'en',
        countryCode: 'LU',
        roles: ['photographer'],
        status: 'active',
      },
    });
    createdUserIds.push(user.id);

    const profile = await prisma.photographerProfile.create({
      data: {
        userId: user.id,
        slug,
        displayName: `Fixture ${label}`,
        bio: {},
        links: { other: [] },
        categories: ['portrait'],
        languages: ['en'],
        city: 'Luxembourg',
        countryCode: 'LU',
        verificationStatus: 'verified',
        stripeAccountId: `acct_fixture_${slug}`,
        stripeOnboardingComplete: true,
        stripePayoutsEnabled: true,
        ratingAvg: 4.5,
        ratingCount: 10,
        isPublished: true,
      },
    });

    const upload = await prisma.upload.create({
      data: {
        ownerId: user.id,
        purpose: 'portfolio',
        status: 'processed',
        mimeType: 'image/jpeg',
        declaredSizeBytes: 8192,
        actualSizeBytes: 8192,
        width: 1600,
        height: 900,
        objectKey: `fixtures/${slug}/portfolio-1/original.jpg`,
        variants: placeholderVariants(`fixtures/${slug}/portfolio-1`),
        virusScanStatus: 'clean',
      },
    });
    const portfolioImage = await prisma.portfolioImage.create({
      data: {
        profileId: profile.id,
        uploadId: upload.id,
        width: 1600,
        height: 900,
        order: 1,
        status: overrides.status ?? 'pending_review',
      },
    });

    const check = await prisma.provenanceCheck.create({
      data: {
        portfolioImageId: portfolioImage.id,
        aiScore: overrides.score ?? '0.9',
        aiVendor: 'vendor-x',
        reverseMatches: [],
        c2paValid: null,
        exifCamera: null,
        exifCapturedAt: null,
        score: overrides.score ?? '0.9',
        verdict: overrides.verdict ?? 'pass',
        raw: {},
        ...(overrides.createdAt ? { createdAt: overrides.createdAt } : {}),
      },
    });

    return { id: check.id, portfolioImageId: portfolioImage.id, profileId: profile.id };
  }

  async function fetchPage(
    query: string,
    cursor: string | null,
    headers: Record<string, string | undefined>,
  ): Promise<PageBody<ProvenanceSummaryBody>> {
    const cursorParam = cursor ? `&cursor=${encodeURIComponent(cursor)}` : '';
    const response = await fastify().inject({
      method: 'GET',
      url: `/v1/admin/provenance?${query}${cursorParam}`,
      headers,
    });
    return response.json<PageBody<ProvenanceSummaryBody>>();
  }

  async function clearRateLimitKeys(): Promise<void> {
    const patterns = [`rate-limit:auth:*:${FAKE_IP}`, `lockout:auth:*:${FAKE_IP}`];
    const globbed = (await Promise.all(patterns.map((pattern) => redis.keys(pattern)))).flat();
    if (globbed.length > 0) {
      await redis.del(...globbed);
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
    provenanceQueueConnection = new Redis(testEnv.REDIS_URL, { maxRetriesPerRequest: null });
    provenanceQueue = new Queue(PROVENANCE_CHECK_QUEUE_NAME, {
      connection: provenanceQueueConnection,
    });
    await clearRateLimitKeys();
  });

  afterEach(async () => {
    await clearRateLimitKeys();
  });

  afterAll(async () => {
    if (createdUserIds.length > 0) {
      await prisma.portfolioImage.deleteMany({
        where: { profile: { userId: { in: createdUserIds } } },
      });
      await prisma.upload.deleteMany({ where: { ownerId: { in: createdUserIds } } });
      await prisma.photographerProfile.deleteMany({ where: { userId: { in: createdUserIds } } });
      await prisma.adminPermissionGrant.deleteMany({
        where: { grantedByAdminId: { in: createdUserIds } },
      });
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    await prisma.$disconnect();
    await provenanceQueue.close();
    provenanceQueueConnection.disconnect();
    redis.disconnect();
    await app.close();
  });

  describe('GET /v1/admin/provenance', () => {
    it('returns 401 when unauthenticated', async () => {
      const response = await fastify().inject({
        method: 'GET',
        url: '/v1/admin/provenance',
        headers: { origin: 'http://localhost:3000' },
      });
      expect(response.statusCode).toBe(401);
    });

    it('returns 403 for an admin without the moderation permission', async () => {
      const admin = await makeAdmin('list-no-permission', ['finance']);
      const response = await fastify().inject({
        method: 'GET',
        url: '/v1/admin/provenance',
        headers: admin.headers,
      });
      expect(response.statusCode).toBe(403);
    });

    it('returns 403 TWO_FACTOR_REQUIRED for a moderation admin whose session has no verified second factor', async () => {
      const admin = await makeAdmin('list-no-2fa', ['moderation']);
      await prisma.session.updateMany({
        where: { userId: admin.id },
        data: { twoFactorVerifiedAt: null },
      });

      const response = await fastify().inject({
        method: 'GET',
        url: '/v1/admin/provenance',
        headers: admin.headers,
      });
      expect(response.statusCode).toBe(403);
      expect(response.json<{ code: string }>().code).toBe('TWO_FACTOR_REQUIRED');
    });

    it('returns 400 for a cursor that does not decode to a valid cursor payload', async () => {
      const admin = await makeAdmin('list-bad-cursor', ['moderation']);
      const response = await fastify().inject({
        method: 'GET',
        url: '/v1/admin/provenance?cursor=not-a-valid-cursor',
        headers: admin.headers,
      });
      expect(response.statusCode).toBe(400);
    });

    it('paginates with no gaps or repeats', async () => {
      const admin = await makeAdmin('pagination', ['moderation']);
      const base = Date.now() - 60_000;
      const created: string[] = [];
      for (let i = 0; i < 5; i += 1) {
        const check = await createFixtureCheck(`pagination-${i.toString()}`, {
          createdAt: new Date(base + i * 1000),
        });
        created.push(check.id);
      }

      const items: ProvenanceSummaryBody[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < 40; page += 1) {
        const body = await fetchPage('limit=2', cursor, admin.headers);
        expect(body.items.length).toBeLessThanOrEqual(2);
        items.push(...body.items.filter((item) => created.includes(item.id)));
        cursor = body.nextCursor;
        if (!cursor) break;
      }

      const ids = items.map((item) => item.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids).toEqual(created);
    });
  });

  describe('GET /v1/admin/provenance/:id', () => {
    it('returns 401 when unauthenticated', async () => {
      const response = await fastify().inject({
        method: 'GET',
        url: `/v1/admin/provenance/${randomUUID()}`,
        headers: { origin: 'http://localhost:3000' },
      });
      expect(response.statusCode).toBe(401);
    });

    it('returns 403 for an admin without the moderation permission', async () => {
      const admin = await makeAdmin('detail-no-permission', ['finance']);
      const response = await fastify().inject({
        method: 'GET',
        url: `/v1/admin/provenance/${randomUUID()}`,
        headers: admin.headers,
      });
      expect(response.statusCode).toBe(403);
    });

    it('returns 404 for a check that does not exist', async () => {
      const admin = await makeAdmin('detail-not-found', ['moderation']);
      const response = await fastify().inject({
        method: 'GET',
        url: `/v1/admin/provenance/${randomUUID()}`,
        headers: admin.headers,
      });
      expect(response.statusCode).toBe(404);
    });

    it('returns the mapped detail for an existing check', async () => {
      const admin = await makeAdmin('detail-ok', ['moderation']);
      const check = await createFixtureCheck('detail-ok');

      const response = await fastify().inject({
        method: 'GET',
        url: `/v1/admin/provenance/${check.id}`,
        headers: admin.headers,
      });
      expect(response.statusCode).toBe(200);
      const body = response.json<ProvenanceDetailBody>();
      expect(body.id).toBe(check.id);
      expect(body.portfolioImageId).toBe(check.portfolioImageId);
      expect(body.aiVendor).toBe('vendor-x');
    });
  });

  describe('POST /v1/admin/provenance/:id/decision', () => {
    it('returns 401 when unauthenticated', async () => {
      const response = await fastify().inject({
        method: 'POST',
        url: `/v1/admin/provenance/${randomUUID()}/decision`,
        headers: { origin: 'http://localhost:3000' },
        payload: { status: 'approved', note: 'looks fine' },
      });
      expect(response.statusCode).toBe(401);
    });

    it('returns 403 for an admin without the moderation permission', async () => {
      const admin = await makeAdmin('decision-no-permission', ['finance']);
      const response = await fastify().inject({
        method: 'POST',
        url: `/v1/admin/provenance/${randomUUID()}/decision`,
        headers: admin.headers,
        payload: { status: 'approved', note: 'looks fine' },
      });
      expect(response.statusCode).toBe(403);
    });

    it('returns 403 TWO_FACTOR_REQUIRED for a moderation admin whose session has no verified second factor', async () => {
      const admin = await makeAdmin('decision-no-2fa', ['moderation']);
      await prisma.session.updateMany({
        where: { userId: admin.id },
        data: { twoFactorVerifiedAt: null },
      });

      const response = await fastify().inject({
        method: 'POST',
        url: `/v1/admin/provenance/${randomUUID()}/decision`,
        headers: admin.headers,
        payload: { status: 'approved', note: 'looks fine' },
      });
      expect(response.statusCode).toBe(403);
      expect(response.json<{ code: string }>().code).toBe('TWO_FACTOR_REQUIRED');
    });

    it('returns 400 when the note is missing', async () => {
      const admin = await makeAdmin('decision-bad-body', ['moderation']);
      const response = await fastify().inject({
        method: 'POST',
        url: `/v1/admin/provenance/${randomUUID()}/decision`,
        headers: admin.headers,
        payload: { status: 'approved' },
      });
      expect(response.statusCode).toBe(400);
    });

    it('returns 404 for a check that does not exist', async () => {
      const admin = await makeAdmin('decision-not-found', ['moderation']);
      const response = await fastify().inject({
        method: 'POST',
        url: `/v1/admin/provenance/${randomUUID()}/decision`,
        headers: admin.headers,
        payload: { status: 'approved', note: 'looks fine' },
      });
      expect(response.statusCode).toBe(404);
    });

    it('updates the portfolio image status and writes an audit row', async () => {
      const admin = await makeAdmin('decision-ok', ['moderation']);
      const check = await createFixtureCheck('decision-ok', { status: 'pending_review' });

      const response = await fastify().inject({
        method: 'POST',
        url: `/v1/admin/provenance/${check.id}/decision`,
        headers: admin.headers,
        remoteAddress: FAKE_IP,
        payload: { status: 'flagged', note: 'possible AI generation' },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json<ProvenanceDetailBody>();
      expect(body.portfolioImageStatus).toBe('flagged');
      expect(body.reviewedByAdminId).toBe(admin.id);
      expect(body.note).toBe('possible AI generation');

      const portfolioImage = await prisma.portfolioImage.findUnique({
        where: { id: check.portfolioImageId },
      });
      expect(portfolioImage?.status).toBe('flagged');

      const auditRow = await prisma.auditLog.findFirst({
        where: { action: 'provenance.decision', targetId: check.id },
      });
      expect(auditRow).not.toBeNull();
      expect(auditRow?.actorType).toBe('admin');
      expect(auditRow?.actorId).toBe(admin.id);
      expect(auditRow?.targetType).toBe('ProvenanceCheck');
      expect(auditRow?.before).toEqual({
        portfolioImageStatus: 'pending_review',
        reviewedByAdminId: null,
      });
      expect(auditRow?.after).toEqual({
        portfolioImageStatus: 'flagged',
        note: 'possible AI generation',
      });
      expect(auditRow?.ip).toBe(FAKE_IP);
    });
  });

  describe('POST /v1/admin/provenance/:id/recheck', () => {
    it('returns 401 when unauthenticated', async () => {
      const response = await fastify().inject({
        method: 'POST',
        url: `/v1/admin/provenance/${randomUUID()}/recheck`,
        headers: { origin: 'http://localhost:3000' },
      });
      expect(response.statusCode).toBe(401);
    });

    it('returns 403 for an admin without the moderation permission', async () => {
      const admin = await makeAdmin('recheck-no-permission', ['finance']);
      const response = await fastify().inject({
        method: 'POST',
        url: `/v1/admin/provenance/${randomUUID()}/recheck`,
        headers: admin.headers,
      });
      expect(response.statusCode).toBe(403);
    });

    it('returns 404 for a check that does not exist', async () => {
      const admin = await makeAdmin('recheck-not-found', ['moderation']);
      const response = await fastify().inject({
        method: 'POST',
        url: `/v1/admin/provenance/${randomUUID()}/recheck`,
        headers: admin.headers,
      });
      expect(response.statusCode).toBe(404);
    });

    it('enqueues a forced provenance check and writes an audit row', async () => {
      const admin = await makeAdmin('recheck-ok', ['moderation']);
      const check = await createFixtureCheck('recheck-ok');

      const response = await fastify().inject({
        method: 'POST',
        url: `/v1/admin/provenance/${check.id}/recheck`,
        headers: admin.headers,
        remoteAddress: FAKE_IP,
      });
      expect(response.statusCode).toBe(200);

      const auditRow = await prisma.auditLog.findFirst({
        where: { action: 'provenance.recheck', targetId: check.id },
      });
      expect(auditRow).not.toBeNull();
      expect(auditRow?.actorType).toBe('admin');
      expect(auditRow?.actorId).toBe(admin.id);
      expect(auditRow?.targetType).toBe('ProvenanceCheck');
      expect(auditRow?.before).toBeNull();
      expect(auditRow?.after).toEqual({ portfolioImageId: check.portfolioImageId });
      expect(auditRow?.ip).toBe(FAKE_IP);

      const enqueuedJob = await provenanceQueue.getJob(check.portfolioImageId);
      expect(enqueuedJob).not.toBeNull();
      expect(enqueuedJob?.data).toEqual({ portfolioImageId: check.portfolioImageId, force: true });
    });
  });
});
