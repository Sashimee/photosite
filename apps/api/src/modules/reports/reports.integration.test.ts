import { randomUUID } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createPrismaClient, type PrismaClient } from '@photoo/db';
import { ADMIN_PERMISSIONS, type AdminPermission } from '@photoo/shared';
import { Redis } from 'ioredis';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../../testing/create-test-app.js';
import { waitForLinkInEmail } from '../../testing/mailpit.js';
import { requireIntegrationEnv } from '../../testing/require-integration-env.js';
import { generateTotpCode } from '../../testing/totp.js';
import { TEST_ENV } from '../../testing/test-env.js';

const testEnv = requireIntegrationEnv(['TEST_DATABASE_URL', 'REDIS_URL']);
const PASSWORD = `photoo-test-${randomUUID()}`;
// Distinct per-file IP and coordinates (issue #97): shared Redis and DB with
// other integration suites running in parallel.
const FAKE_IP = '10.50.12.1';
const RUN_ID = randomUUID().replaceAll('-', '').slice(0, 8);
const RUN_LAT = 30 + (Number.parseInt(RUN_ID, 16) % 200) / 10;
const RUN_LNG = 30 + (Number.parseInt(RUN_ID, 16) % 150) / 10;

function extractFragmentToken(link: string): string | null {
  const hashIndex = link.indexOf('#token=');
  if (hashIndex === -1) {
    return null;
  }
  return decodeURIComponent(link.slice(hashIndex + '#token='.length));
}

function uniqueEmail(label: string): string {
  return `reports-${label}-${randomUUID()}@photoo.test`;
}

interface ReportBody {
  id: string;
  reporterId: string | null;
  targetType: string;
  targetId: string;
  reason: string;
  status: string;
  adminId: string | null;
  resolution: string | null;
}

interface ReportsPage {
  items: ReportBody[];
  nextCursor: string | null;
}

interface PublicProfileBody {
  slug: string;
  portfolio: { id: string }[];
}

describe('reports integration', () => {
  if (!testEnv) {
    it.skip('skipped: TEST_DATABASE_URL or REDIS_URL is not set', () => undefined);
    return;
  }

  let app: NestFastifyApplication;
  let prisma: PrismaClient;
  let redis: Redis;
  const createdUserIds: string[] = [];
  const createdProfileIds: string[] = [];
  const createdRequestIds: string[] = [];

  function fastify() {
    return app.getHttpAdapter().getInstance();
  }

  function authHeaders(token: string) {
    return { authorization: `Bearer ${token}` };
  }

  async function signUpVerifyAndSignIn(
    roles: readonly string[],
    label: string,
  ): Promise<{ token: string; id: string; email: string }> {
    const email = uniqueEmail(label);
    const signUpResponse = await fastify().inject({
      method: 'POST',
      url: '/v1/auth/sign-up',
      remoteAddress: FAKE_IP,
      payload: { email, password: PASSWORD, roles, locale: 'en' },
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

    const signInResponse = await fastify().inject({
      method: 'POST',
      url: '/v1/auth/sign-in',
      remoteAddress: FAKE_IP,
      payload: { email, password: PASSWORD },
    });
    const body = signInResponse.json<{ user: { id: string }; session: { token: string } }>();
    return { token: body.session.token, id: body.user.id, email };
  }

  function sessionCookieHeader(response: {
    cookies: { name: string; value: string }[];
  }): string | undefined {
    const cookie = response.cookies.find((candidate) => candidate.name === 'photoo_session');
    return cookie ? `${cookie.name}=${cookie.value}` : undefined;
  }

  // Mirrors admin.integration.test.ts's makeAdmin: every admin session needs
  // a verified second factor (requireAdminSession), regardless of whether
  // the route it calls also demands a fresh one.
  async function makeAdmin(
    label: string,
    permissions: readonly AdminPermission[] = [],
  ): Promise<{ headers: { cookie: string; origin: string }; id: string; email: string }> {
    const admin = await signUpVerifyAndSignIn(['client'], label);
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

  async function createPublishedProfile(suffix: string) {
    const owner = await signUpVerifyAndSignIn(['photographer'], `profile-${suffix}`);
    const profile = await prisma.photographerProfile.create({
      data: {
        userId: owner.id,
        slug: `fx-reports-${suffix}-${RUN_ID}`,
        displayName: `Fx Reports ${suffix}`,
        bio: {},
        links: { other: [] },
        categories: ['portrait'],
        languages: ['en'],
        city: `Fx Reports City ${suffix}`,
        countryCode: 'LU',
        verificationStatus: 'verified',
        isPublished: true,
      },
    });
    createdProfileIds.push(profile.id);
    await prisma.$executeRaw`
      UPDATE "PhotographerProfile"
      SET location = ST_SetSRID(ST_MakePoint(${RUN_LNG}, ${RUN_LAT}), 4326)::geography
      WHERE id = ${profile.id}
    `;
    return { ...profile, ownerId: owner.id };
  }

  async function createApprovedPortfolioImage(profileId: string, ownerId: string, suffix: string) {
    const upload = await prisma.upload.create({
      data: {
        ownerId,
        purpose: 'portfolio',
        status: 'processed',
        mimeType: 'image/jpeg',
        declaredSizeBytes: 8192,
        actualSizeBytes: 8192,
        width: 1600,
        height: 900,
        objectKey: `fixtures/reports/${suffix}/original.jpg`,
        variants: placeholderVariants(`fixtures/reports/${suffix}`),
        virusScanStatus: 'clean',
      },
    });
    return prisma.portfolioImage.create({
      data: {
        profileId,
        uploadId: upload.id,
        width: 1600,
        height: 900,
        order: 1,
        status: 'approved',
      },
    });
  }

  async function createOpenRequest(clientId: string, suffix: string) {
    const request = await prisma.request.create({
      data: {
        clientId,
        title: `Fx report request ${suffix}`,
        category: 'portrait',
        description: 'Fixture request for report/takedown tests',
        eventDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        address: {},
        city: `Fx Reports City ${suffix}`,
        countryCode: 'LU',
        budgetMinCents: 10000,
        budgetMaxCents: 20000,
        currency: 'EUR',
        usage: 'personal',
        expiresAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
      },
    });
    createdRequestIds.push(request.id);
    return request;
  }

  async function fetchPublicProfile(slug: string) {
    return fastify().inject({ method: 'GET', url: `/v1/photographers/${slug}` });
  }

  async function clearRateLimitKeys(): Promise<void> {
    const patterns = [
      `rate-limit:auth:*:${FAKE_IP}`,
      `lockout:auth:*:${FAKE_IP}`,
      `rate-limit:reports:create:ip:${FAKE_IP}`,
      `lockout:reports:create:ip:${FAKE_IP}`,
    ];
    const accountKeys = createdUserIds.flatMap((id) => [
      `rate-limit:reports:create:account:${id}`,
      `lockout:reports:create:account:${id}`,
      `rate-limit:admin:mutation:admin:${id}`,
      `lockout:admin:mutation:admin:${id}`,
    ]);
    const globbed = (await Promise.all(patterns.map((pattern) => redis.keys(pattern)))).flat();
    const all = [...globbed, ...accountKeys];
    if (all.length > 0) {
      await redis.del(...all);
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
    // `Report.targetType`/`targetId` is polymorphic with no foreign key
    // (D23), so nothing cascades into it: every report created against a
    // fixture target, including anonymous ones, has to be swept explicitly
    // before the target itself is deleted.
    const imageIds =
      createdProfileIds.length > 0
        ? (
            await prisma.portfolioImage.findMany({
              where: { profileId: { in: createdProfileIds } },
              select: { id: true },
            })
          ).map((image) => image.id)
        : [];
    const reportTargetIds = [...createdProfileIds, ...imageIds, ...createdRequestIds];
    if (reportTargetIds.length > 0 || createdUserIds.length > 0) {
      await prisma.report.deleteMany({
        where: {
          OR: [
            ...(reportTargetIds.length > 0 ? [{ targetId: { in: reportTargetIds } }] : []),
            ...(createdUserIds.length > 0 ? [{ reporterId: { in: createdUserIds } }] : []),
          ],
        },
      });
    }
    if (createdProfileIds.length > 0) {
      await prisma.portfolioImage.deleteMany({ where: { profileId: { in: createdProfileIds } } });
    }
    if (createdRequestIds.length > 0) {
      await prisma.request.deleteMany({ where: { id: { in: createdRequestIds } } });
    }
    if (createdUserIds.length > 0) {
      await prisma.upload.deleteMany({ where: { ownerId: { in: createdUserIds } } });
      await prisma.photographerProfile.deleteMany({ where: { userId: { in: createdUserIds } } });
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    await prisma.$disconnect();
    redis.disconnect();
    await app.close();
  });

  describe('POST /v1/reports', () => {
    it('accepts an anonymous report and stores it with a null reporterId', async () => {
      const profile = await createPublishedProfile(`anon-${randomUUID().slice(0, 6)}`);

      const response = await fastify().inject({
        method: 'POST',
        url: '/v1/reports',
        remoteAddress: FAKE_IP,
        payload: {
          targetType: 'photographer_profile',
          targetId: profile.id,
          reason: 'Suspicious listing, likely a scam',
        },
      });

      expect(response.statusCode).toBe(201);
      expect(response.json()).toEqual({ status: 'received' });

      const row = await prisma.report.findFirst({ where: { targetId: profile.id } });
      expect(row).not.toBeNull();
      expect(row?.reporterId).toBeNull();
      expect(row?.status).toBe('open');
    });

    it('attributes the report to a signed-in reporter', async () => {
      const reporter = await signUpVerifyAndSignIn(
        ['client'],
        `reporter-${randomUUID().slice(0, 6)}`,
      );
      const profile = await createPublishedProfile(`signed-in-${randomUUID().slice(0, 6)}`);

      const response = await fastify().inject({
        method: 'POST',
        url: '/v1/reports',
        remoteAddress: FAKE_IP,
        headers: authHeaders(reporter.token),
        payload: {
          targetType: 'photographer_profile',
          targetId: profile.id,
          reason: 'Impersonating another photographer',
        },
      });

      expect(response.statusCode).toBe(201);
      const row = await prisma.report.findFirst({
        where: { targetId: profile.id, reporterId: reporter.id },
      });
      expect(row).not.toBeNull();
    });

    // Decision (documented in docs/steps/1A.11-admin-api.md 1A.11c and the
    // service's own comment): a second open notice from the same signed-in
    // reporter against the same target is accepted, not rejected with 409.
    // The first notice already reached the admin queue, so there is nothing
    // to fail; it is folded into the existing open report instead of adding
    // a duplicate row for triage. Anonymous reports are never de-duplicated,
    // since there is no reporter identity to de-duplicate against without
    // fingerprinting a signed-out visitor.
    it('accepts a duplicate report from the same reporter without creating a second open row', async () => {
      const reporter = await signUpVerifyAndSignIn(
        ['client'],
        `duplicate-${randomUUID().slice(0, 6)}`,
      );
      const profile = await createPublishedProfile(`duplicate-${randomUUID().slice(0, 6)}`);
      const payload = {
        targetType: 'photographer_profile',
        targetId: profile.id,
        reason: 'Fake reviews',
      };

      const first = await fastify().inject({
        method: 'POST',
        url: '/v1/reports',
        remoteAddress: FAKE_IP,
        headers: authHeaders(reporter.token),
        payload,
      });
      const second = await fastify().inject({
        method: 'POST',
        url: '/v1/reports',
        remoteAddress: FAKE_IP,
        headers: authHeaders(reporter.token),
        payload,
      });

      expect(first.statusCode).toBe(201);
      expect(second.statusCode).toBe(201);
      const rows = await prisma.report.findMany({
        where: { targetId: profile.id, reporterId: reporter.id },
      });
      expect(rows).toHaveLength(1);
    });

    it('accepts a new report once the earlier one has been resolved', async () => {
      const reporter = await signUpVerifyAndSignIn(
        ['client'],
        `reopen-${randomUUID().slice(0, 6)}`,
      );
      const admin = await makeAdmin(`reopen-admin-${randomUUID().slice(0, 6)}`, ['moderation']);
      const profile = await createPublishedProfile(`reopen-${randomUUID().slice(0, 6)}`);
      const payload = {
        targetType: 'photographer_profile',
        targetId: profile.id,
        reason: 'Suspected fraud',
      };

      await fastify().inject({
        method: 'POST',
        url: '/v1/reports',
        remoteAddress: FAKE_IP,
        headers: authHeaders(reporter.token),
        payload,
      });
      const firstReport = await prisma.report.findFirstOrThrow({
        where: { targetId: profile.id, reporterId: reporter.id },
      });
      await fastify().inject({
        method: 'POST',
        url: `/v1/admin/reports/${firstReport.id}/resolve`,
        headers: admin.headers,
        payload: { status: 'dismissed', resolution: 'Investigated, no issue found' },
      });

      await fastify().inject({
        method: 'POST',
        url: '/v1/reports',
        remoteAddress: FAKE_IP,
        headers: authHeaders(reporter.token),
        payload,
      });

      const rows = await prisma.report.findMany({
        where: { targetId: profile.id, reporterId: reporter.id },
      });
      expect(rows).toHaveLength(2);
    });

    it('returns 404 for a target that does not exist', async () => {
      const response = await fastify().inject({
        method: 'POST',
        url: '/v1/reports',
        remoteAddress: FAKE_IP,
        payload: {
          targetType: 'photographer_profile',
          targetId: randomUUID(),
          reason: 'Does not matter',
        },
      });
      expect(response.statusCode).toBe(404);
    });

    it('rejects an unsupported target type', async () => {
      const response = await fastify().inject({
        method: 'POST',
        url: '/v1/reports',
        remoteAddress: FAKE_IP,
        payload: { targetType: 'user', targetId: randomUUID(), reason: 'Harassment' },
      });
      expect(response.statusCode).toBe(400);
    });

    it('rejects an empty reason', async () => {
      const profile = await createPublishedProfile(`empty-reason-${randomUUID().slice(0, 6)}`);
      const response = await fastify().inject({
        method: 'POST',
        url: '/v1/reports',
        remoteAddress: FAKE_IP,
        payload: { targetType: 'photographer_profile', targetId: profile.id, reason: '' },
      });
      expect(response.statusCode).toBe(400);
    });

    it('never reveals more about the target than acceptance, even when it is missing', async () => {
      const response = await fastify().inject({
        method: 'POST',
        url: '/v1/reports',
        remoteAddress: FAKE_IP,
        payload: {
          targetType: 'photographer_profile',
          targetId: randomUUID(),
          reason: 'Does not matter',
        },
      });
      expect(response.json()).not.toHaveProperty('targetType');
      expect(response.json()).not.toHaveProperty('reporterId');
    });

    it('rate limits repeated reports from the same IP', async () => {
      const rateLimitIp = '10.50.12.2';
      const profile = await createPublishedProfile(`rate-limit-${randomUUID().slice(0, 6)}`);
      const payload = {
        targetType: 'photographer_profile',
        targetId: profile.id,
        reason: 'Rate limit probe',
      };

      let lastStatus = 0;
      for (let attempt = 0; attempt < 11; attempt += 1) {
        const response = await fastify().inject({
          method: 'POST',
          url: '/v1/reports',
          remoteAddress: rateLimitIp,
          payload,
        });
        lastStatus = response.statusCode;
      }

      expect(lastStatus).toBe(429);
      await redis.del(
        `rate-limit:reports:create:ip:${rateLimitIp}`,
        `lockout:reports:create:ip:${rateLimitIp}`,
      );
    });
  });

  describe('GET /v1/admin/reports', () => {
    it('requires the moderation permission', async () => {
      for (const permission of ADMIN_PERMISSIONS) {
        await clearRateLimitKeys();
        const admin = await makeAdmin(`list-matrix-${permission}-${randomUUID().slice(0, 6)}`, [
          permission,
        ]);
        const response = await fastify().inject({
          method: 'GET',
          url: '/v1/admin/reports',
          headers: admin.headers,
        });
        if (permission === 'moderation') {
          expect(response.statusCode).toBe(200);
        } else {
          expect(response.statusCode).toBe(403);
        }
      }
    });

    it('returns 401 without a session', async () => {
      const response = await fastify().inject({ method: 'GET', url: '/v1/admin/reports' });
      expect(response.statusCode).toBe(401);
    });

    it('filters by status and target', async () => {
      const admin = await makeAdmin(`list-filter-${randomUUID().slice(0, 6)}`, ['moderation']);
      const profile = await createPublishedProfile(`list-filter-${randomUUID().slice(0, 6)}`);
      await fastify().inject({
        method: 'POST',
        url: '/v1/reports',
        remoteAddress: FAKE_IP,
        payload: {
          targetType: 'photographer_profile',
          targetId: profile.id,
          reason: 'List filter fixture',
        },
      });

      const response = await fastify().inject({
        method: 'GET',
        url: `/v1/admin/reports?status=open&targetType=photographer_profile&targetId=${profile.id}`,
        headers: admin.headers,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<ReportsPage>();
      expect(body.items.length).toBeGreaterThan(0);
      expect(body.items.every((item) => item.targetId === profile.id)).toBe(true);
    });
  });

  describe('POST /v1/admin/reports/:id/resolve', () => {
    async function createOpenReport(suffix: string) {
      const profile = await createPublishedProfile(suffix);
      await fastify().inject({
        method: 'POST',
        url: '/v1/reports',
        remoteAddress: FAKE_IP,
        payload: {
          targetType: 'photographer_profile',
          targetId: profile.id,
          reason: `Fixture report ${suffix}`,
        },
      });
      const report = await prisma.report.findFirstOrThrow({ where: { targetId: profile.id } });
      return { profile, report };
    }

    it('requires the moderation permission', async () => {
      for (const permission of ADMIN_PERMISSIONS) {
        await clearRateLimitKeys();
        const { report } = await createOpenReport(
          `resolve-matrix-${permission}-${randomUUID().slice(0, 6)}`,
        );
        const admin = await makeAdmin(`resolve-matrix-${permission}-${randomUUID().slice(0, 6)}`, [
          permission,
        ]);
        const response = await fastify().inject({
          method: 'POST',
          url: `/v1/admin/reports/${report.id}/resolve`,
          headers: admin.headers,
          payload: { status: 'dismissed', resolution: 'Fixture resolution' },
        });
        if (permission === 'moderation') {
          expect(response.statusCode).toBe(200);
        } else {
          expect(response.statusCode).toBe(403);
        }
      }
    });

    it('rejects a resolution with no statement of reasons', async () => {
      const admin = await makeAdmin(`resolve-empty-${randomUUID().slice(0, 6)}`, ['moderation']);
      const { report } = await createOpenReport(`resolve-empty-${randomUUID().slice(0, 6)}`);

      const response = await fastify().inject({
        method: 'POST',
        url: `/v1/admin/reports/${report.id}/resolve`,
        headers: admin.headers,
        payload: { status: 'dismissed', resolution: '' },
      });

      expect(response.statusCode).toBe(400);
      const unchanged = await prisma.report.findUniqueOrThrow({ where: { id: report.id } });
      expect(unchanged.status).toBe('open');
    });

    it('resolves an open report and writes an audit row', async () => {
      const admin = await makeAdmin(`resolve-ok-${randomUUID().slice(0, 6)}`, ['moderation']);
      const { report } = await createOpenReport(`resolve-ok-${randomUUID().slice(0, 6)}`);

      const response = await fastify().inject({
        method: 'POST',
        url: `/v1/admin/reports/${report.id}/resolve`,
        headers: admin.headers,
        payload: { status: 'dismissed', resolution: 'Reviewed, no violation' },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<ReportBody>();
      expect(body.status).toBe('dismissed');
      expect(body.resolution).toBe('Reviewed, no violation');
      expect(body.adminId).toBe(admin.id);

      const auditRow = await prisma.auditLog.findFirst({
        where: { action: 'report.dismissed', targetType: 'Report', targetId: report.id },
      });
      expect(auditRow).not.toBeNull();
      expect(auditRow?.actorType).toBe('admin');
      expect(auditRow?.actorId).toBe(admin.id);
      expect(auditRow?.before).toEqual({ status: 'open' });
      expect(auditRow?.after).toEqual({
        status: 'dismissed',
        resolution: 'Reviewed, no violation',
      });
    });

    it('returns 409 for a report that is already resolved', async () => {
      const admin = await makeAdmin(`resolve-conflict-${randomUUID().slice(0, 6)}`, ['moderation']);
      const { report } = await createOpenReport(`resolve-conflict-${randomUUID().slice(0, 6)}`);

      await fastify().inject({
        method: 'POST',
        url: `/v1/admin/reports/${report.id}/resolve`,
        headers: admin.headers,
        payload: { status: 'resolved', resolution: 'First resolution' },
      });
      const second = await fastify().inject({
        method: 'POST',
        url: `/v1/admin/reports/${report.id}/resolve`,
        headers: admin.headers,
        payload: { status: 'dismissed', resolution: 'Second attempt' },
      });

      expect(second.statusCode).toBe(409);
    });

    it('returns 404 for an unknown report', async () => {
      const admin = await makeAdmin(`resolve-404-${randomUUID().slice(0, 6)}`, ['moderation']);
      const response = await fastify().inject({
        method: 'POST',
        url: `/v1/admin/reports/${randomUUID()}/resolve`,
        headers: admin.headers,
        payload: { status: 'dismissed', resolution: 'Fixture' },
      });
      expect(response.statusCode).toBe(404);
    });
  });

  describe('POST /v1/admin/reports/:id/takedown', () => {
    it('requires the moderation permission', async () => {
      const profile = await createPublishedProfile(`takedown-matrix-${randomUUID().slice(0, 6)}`);
      for (const permission of ADMIN_PERMISSIONS) {
        await fastify().inject({
          method: 'POST',
          url: '/v1/reports',
          remoteAddress: FAKE_IP,
          payload: {
            targetType: 'photographer_profile',
            targetId: profile.id,
            reason: `Matrix ${permission}`,
          },
        });
        const report = await prisma.report.findFirstOrThrow({
          where: { targetId: profile.id, status: 'open' },
        });
        await clearRateLimitKeys();
        const admin = await makeAdmin(`takedown-matrix-${permission}-${randomUUID().slice(0, 6)}`, [
          permission,
        ]);
        const response = await fastify().inject({
          method: 'POST',
          url: `/v1/admin/reports/${report.id}/takedown`,
          headers: admin.headers,
          payload: { resolution: 'Fixture takedown' },
        });
        if (permission === 'moderation') {
          expect(response.statusCode).toBe(200);
        } else {
          expect(response.statusCode).toBe(403);
        }
      }
    });

    it('requires a statement of reasons', async () => {
      const admin = await makeAdmin(`takedown-empty-${randomUUID().slice(0, 6)}`, ['moderation']);
      const profile = await createPublishedProfile(`takedown-empty-${randomUUID().slice(0, 6)}`);
      await fastify().inject({
        method: 'POST',
        url: '/v1/reports',
        remoteAddress: FAKE_IP,
        payload: {
          targetType: 'photographer_profile',
          targetId: profile.id,
          reason: 'Fixture',
        },
      });
      const report = await prisma.report.findFirstOrThrow({ where: { targetId: profile.id } });

      const response = await fastify().inject({
        method: 'POST',
        url: `/v1/admin/reports/${report.id}/takedown`,
        headers: admin.headers,
        payload: { resolution: '' },
      });

      expect(response.statusCode).toBe(400);
    });

    it('takes down a portfolio image: hidden from the public profile, still readable in the database', async () => {
      const admin = await makeAdmin(`takedown-image-${randomUUID().slice(0, 6)}`, ['moderation']);
      const profile = await createPublishedProfile(`takedown-image-${randomUUID().slice(0, 6)}`);
      const image = await createApprovedPortfolioImage(
        profile.id,
        profile.ownerId,
        `takedown-image-${randomUUID().slice(0, 6)}`,
      );

      const before = await fetchPublicProfile(profile.slug);
      expect(before.json<PublicProfileBody>().portfolio.map((item) => item.id)).toContain(image.id);

      await fastify().inject({
        method: 'POST',
        url: '/v1/reports',
        remoteAddress: FAKE_IP,
        payload: { targetType: 'portfolio_image', targetId: image.id, reason: 'AI-generated' },
      });
      const report = await prisma.report.findFirstOrThrow({ where: { targetId: image.id } });

      const response = await fastify().inject({
        method: 'POST',
        url: `/v1/admin/reports/${report.id}/takedown`,
        headers: admin.headers,
        payload: { resolution: 'Confirmed AI-generated, image removed' },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<ReportBody>();
      expect(body.status).toBe('resolved');
      expect(body.resolution).toBe('Confirmed AI-generated, image removed');

      const after = await fetchPublicProfile(profile.slug);
      expect(after.statusCode).toBe(200);
      expect(after.json<PublicProfileBody>().portfolio.map((item) => item.id)).not.toContain(
        image.id,
      );

      const dbRow = await prisma.portfolioImage.findUniqueOrThrow({ where: { id: image.id } });
      expect(dbRow.deletedAt).not.toBeNull();

      const auditRow = await prisma.auditLog.findFirst({
        where: { action: 'report.takedown', targetType: 'Report', targetId: report.id },
      });
      expect(auditRow).not.toBeNull();
      expect((auditRow?.after as { targetRemoved?: boolean } | null)?.targetRemoved).toBe(true);
    });

    it('takes down a photographer profile: public reads 404, the row stays in the database', async () => {
      const admin = await makeAdmin(`takedown-profile-${randomUUID().slice(0, 6)}`, ['moderation']);
      const profile = await createPublishedProfile(`takedown-profile-${randomUUID().slice(0, 6)}`);

      await fastify().inject({
        method: 'POST',
        url: '/v1/reports',
        remoteAddress: FAKE_IP,
        payload: {
          targetType: 'photographer_profile',
          targetId: profile.id,
          reason: 'Impersonation',
        },
      });
      const report = await prisma.report.findFirstOrThrow({ where: { targetId: profile.id } });

      const response = await fastify().inject({
        method: 'POST',
        url: `/v1/admin/reports/${report.id}/takedown`,
        headers: admin.headers,
        payload: { resolution: 'Confirmed impersonation, profile removed' },
      });
      expect(response.statusCode).toBe(200);

      const publicRead = await fetchPublicProfile(profile.slug);
      expect(publicRead.statusCode).toBe(404);

      const dbRow = await prisma.photographerProfile.findUniqueOrThrow({
        where: { id: profile.id },
      });
      expect(dbRow.deletedAt).not.toBeNull();
    });

    it('takes down a request target', async () => {
      const admin = await makeAdmin(`takedown-request-${randomUUID().slice(0, 6)}`, ['moderation']);
      const client = await signUpVerifyAndSignIn(
        ['client'],
        `takedown-request-${randomUUID().slice(0, 6)}`,
      );
      const request = await createOpenRequest(
        client.id,
        `takedown-request-${randomUUID().slice(0, 6)}`,
      );

      await fastify().inject({
        method: 'POST',
        url: '/v1/reports',
        remoteAddress: FAKE_IP,
        payload: { targetType: 'request', targetId: request.id, reason: 'Spam request' },
      });
      const report = await prisma.report.findFirstOrThrow({ where: { targetId: request.id } });

      const response = await fastify().inject({
        method: 'POST',
        url: `/v1/admin/reports/${report.id}/takedown`,
        headers: admin.headers,
        payload: { resolution: 'Confirmed spam, request removed' },
      });
      expect(response.statusCode).toBe(200);

      const dbRow = await prisma.request.findUniqueOrThrow({ where: { id: request.id } });
      expect(dbRow.deletedAt).not.toBeNull();
    });

    it('returns 409 when the report is already resolved', async () => {
      const admin = await makeAdmin(`takedown-conflict-${randomUUID().slice(0, 6)}`, [
        'moderation',
      ]);
      const profile = await createPublishedProfile(`takedown-conflict-${randomUUID().slice(0, 6)}`);
      await fastify().inject({
        method: 'POST',
        url: '/v1/reports',
        remoteAddress: FAKE_IP,
        payload: {
          targetType: 'photographer_profile',
          targetId: profile.id,
          reason: 'Fixture',
        },
      });
      const report = await prisma.report.findFirstOrThrow({ where: { targetId: profile.id } });

      await fastify().inject({
        method: 'POST',
        url: `/v1/admin/reports/${report.id}/takedown`,
        headers: admin.headers,
        payload: { resolution: 'First takedown' },
      });
      const second = await fastify().inject({
        method: 'POST',
        url: `/v1/admin/reports/${report.id}/takedown`,
        headers: admin.headers,
        payload: { resolution: 'Second attempt' },
      });

      expect(second.statusCode).toBe(409);
    });

    it('returns 404 for an unknown report', async () => {
      const admin = await makeAdmin(`takedown-404-${randomUUID().slice(0, 6)}`, ['moderation']);
      const response = await fastify().inject({
        method: 'POST',
        url: `/v1/admin/reports/${randomUUID()}/takedown`,
        headers: admin.headers,
        payload: { resolution: 'Fixture' },
      });
      expect(response.statusCode).toBe(404);
    });
  });
});
