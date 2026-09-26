import { randomUUID } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createPrismaClient, type PrismaClient } from '@photoo/db';
import { GDPR_EXPORT_QUEUE_NAME, gdprResponseDueAt, type AdminPermission } from '@photoo/shared';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../../testing/create-test-app.js';
import { waitForLinkInEmail } from '../../testing/mailpit.js';
import { requireIntegrationEnv } from '../../testing/require-integration-env.js';
import { generateTotpCode } from '../../testing/totp.js';
import { TEST_ENV } from '../../testing/test-env.js';
import { ChatSocketBridge } from '../chat/chat-socket-bridge.js';
import { GdprExportQueueService } from '../gdpr/gdpr-export-queue.service.js';

const testEnv = requireIntegrationEnv(['TEST_DATABASE_URL', 'REDIS_URL']);
const PASSWORD = `photoo-test-${randomUUID()}`;
const FAKE_IP = '10.50.22.1';

interface DataRequestBody {
  id: string;
  type: string;
  status: string;
  channel: string;
  requestedAt: string;
  receivedAt: string;
  completedAt: string | null;
  expiresAt: string | null;
  failureReason: string | null;
  cancelledAt: string | null;
  responseDueAt: string | null;
  answeredLate: boolean;
  user: { id: string; email: string };
  exportKey?: string;
}

interface PageBody<T> {
  items: T[];
  nextCursor: string | null;
}

describe('admin data requests integration', () => {
  if (!testEnv) {
    it.skip('skipped: TEST_DATABASE_URL or REDIS_URL is not set', () => undefined);
    return;
  }

  let app: NestFastifyApplication;
  let prisma: PrismaClient;
  let redis: Redis;
  let exportQueueConnection: Redis;
  let exportQueue: Queue;
  const createdUserIds: string[] = [];

  // Country.code requires exactly two uppercase letters; draw a fresh random
  // one per attempt and retry on collision (mirrors countries.integration
  // .test.ts's createTestCountry) rather than upserting into a row another
  // suite may have created, which would hijack and then delete it out from
  // under that suite.
  function randomCountryCode(): string {
    const pick = () => String.fromCharCode(65 + Math.floor(Math.random() * 16));
    return `${pick()}${pick()}`;
  }
  const FIXTURE_COUNTRY_TIMEZONE = 'Asia/Tokyo';
  let fixtureCountryCode: string | undefined;
  function requireFixtureCountryCode(): string {
    if (!fixtureCountryCode) {
      throw new Error('fixtureCountryCode is not set: beforeAll must run first');
    }
    return fixtureCountryCode;
  }

  function fastify() {
    return app.getHttpAdapter().getInstance();
  }

  function uniqueEmail(label: string): string {
    return `data-requests-admin-${label}-${randomUUID()}@photoo.test`;
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

  async function createSubjectUser(
    label: string,
    status: 'active' | 'suspended' | 'deleted' = 'active',
    countryCode = 'LU',
  ): Promise<{ id: string; email: string }> {
    const email = uniqueEmail(`subject-${label}`);
    const user = await prisma.user.create({
      data: {
        email,
        emailVerifiedAt: new Date(),
        locale: 'en',
        countryCode,
        roles: ['client'],
        status,
        ...(status === 'deleted' ? { deletedAt: new Date() } : {}),
      },
    });
    createdUserIds.push(user.id);
    return { id: user.id, email };
  }

  async function createDataRequest(spec: {
    userId: string;
    type: 'export' | 'delete';
    status: 'pending' | 'processing' | 'ready' | 'completed' | 'failed' | 'cancelled';
    requestedAt: Date;
    // responseDueAt/answeredLate are computed from receivedAt (#378); tests
    // that only care about requestedAt-driven behaviour can omit this and it
    // defaults to requestedAt so the due-date math stays anchored the same.
    receivedAt?: Date;
    channel?: 'in_app' | 'email' | 'support';
    exportKey?: string;
    expiresAt?: Date;
    failureReason?: string;
    completedAt?: Date;
  }): Promise<{ id: string }> {
    const row = await prisma.dataRequest.create({
      data: {
        userId: spec.userId,
        type: spec.type,
        status: spec.status,
        requestedAt: spec.requestedAt,
        receivedAt: spec.receivedAt ?? spec.requestedAt,
        ...(spec.channel ? { channel: spec.channel } : {}),
        ...(spec.exportKey ? { exportKey: spec.exportKey } : {}),
        ...(spec.expiresAt ? { expiresAt: spec.expiresAt } : {}),
        ...(spec.failureReason ? { failureReason: spec.failureReason } : {}),
        ...(spec.completedAt ? { completedAt: spec.completedAt } : {}),
      },
    });
    return { id: row.id };
  }

  async function fetchPage(
    query: string,
    cursor: string | null,
    headers: Record<string, string | undefined>,
  ): Promise<PageBody<DataRequestBody>> {
    const cursorParam = cursor ? `&cursor=${encodeURIComponent(cursor)}` : '';
    const response = await fastify().inject({
      method: 'GET',
      url: `/v1/admin/data-requests?${query}${cursorParam}`,
      headers,
    });
    return response.json<PageBody<DataRequestBody>>();
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
    exportQueueConnection = new Redis(testEnv.REDIS_URL, { maxRetriesPerRequest: null });
    exportQueue = new Queue(GDPR_EXPORT_QUEUE_NAME, { connection: exportQueueConnection });
    await clearRateLimitKeys();
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const code = randomCountryCode();
      try {
        await prisma.country.create({
          data: {
            code,
            name: 'Fixture Non-Luxembourg Country',
            enabled: false,
            currency: 'JPY',
            vatRate: 0,
            requiredDocuments: [],
            legalTexts: {},
            defaultLocale: 'en',
            timezone: FIXTURE_COUNTRY_TIMEZONE,
          },
        });
        fixtureCountryCode = code;
        break;
      } catch {
        continue;
      }
    }
    if (!fixtureCountryCode) {
      throw new Error('could not create fixture country: no unused code found');
    }
  });

  afterEach(async () => {
    await clearRateLimitKeys();
  });

  afterAll(async () => {
    if (createdUserIds.length > 0) {
      await prisma.dataRequest.deleteMany({ where: { userId: { in: createdUserIds } } });
      await prisma.adminPermissionGrant.deleteMany({
        where: { grantedByAdminId: { in: createdUserIds } },
      });
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    if (fixtureCountryCode) {
      await prisma.country.deleteMany({ where: { code: fixtureCountryCode } });
    }
    await prisma.$disconnect();
    await exportQueue.close();
    exportQueueConnection.disconnect();
    redis.disconnect();
    await app.close();
  });

  describe('GET /v1/admin/data-requests', () => {
    it('returns 401 when unauthenticated', async () => {
      const response = await fastify().inject({
        method: 'GET',
        url: '/v1/admin/data-requests',
        headers: { origin: 'http://localhost:3000' },
      });
      expect(response.statusCode).toBe(401);
    });

    it('returns 403 for an admin without the support permission', async () => {
      const admin = await makeAdmin('list-no-permission', ['finance']);
      const response = await fastify().inject({
        method: 'GET',
        url: '/v1/admin/data-requests',
        headers: admin.headers,
      });
      expect(response.statusCode).toBe(403);
    });

    it('returns 403 TWO_FACTOR_REQUIRED for a support admin whose session has no verified second factor', async () => {
      const admin = await makeAdmin('list-no-2fa', ['support']);
      await prisma.session.updateMany({
        where: { userId: admin.id },
        data: { twoFactorVerifiedAt: null },
      });

      const response = await fastify().inject({
        method: 'GET',
        url: '/v1/admin/data-requests',
        headers: admin.headers,
      });
      expect(response.statusCode).toBe(403);
      expect(response.json<{ code: string }>().code).toBe('TWO_FACTOR_REQUIRED');
    });

    it('returns 400 for an unknown status filter', async () => {
      const admin = await makeAdmin('list-bad-status', ['support']);
      const response = await fastify().inject({
        method: 'GET',
        url: '/v1/admin/data-requests?status=archived',
        headers: admin.headers,
      });
      expect(response.statusCode).toBe(400);
    });

    it('returns 400 for an unknown type filter', async () => {
      const admin = await makeAdmin('list-bad-type', ['support']);
      const response = await fastify().inject({
        method: 'GET',
        url: '/v1/admin/data-requests?type=wipe',
        headers: admin.headers,
      });
      expect(response.statusCode).toBe(400);
    });

    it('returns 400 for a cursor that does not decode to a valid cursor payload', async () => {
      const admin = await makeAdmin('list-bad-cursor', ['support']);
      const response = await fastify().inject({
        method: 'GET',
        url: '/v1/admin/data-requests?cursor=not-a-valid-cursor',
        headers: admin.headers,
      });
      expect(response.statusCode).toBe(400);
    });

    it('returns 400 for a cursor forged from another endpoint', async () => {
      const admin = await makeAdmin('list-foreign-cursor', ['support']);
      const foreignCursor = Buffer.from(
        JSON.stringify({ createdAt: new Date().toISOString(), id: randomUUID() }),
        'utf8',
      ).toString('base64url');
      const response = await fastify().inject({
        method: 'GET',
        url: `/v1/admin/data-requests?cursor=${encodeURIComponent(foreignCursor)}`,
        headers: admin.headers,
      });
      expect(response.statusCode).toBe(400);
    });

    it('returns an empty page with a null cursor when nothing matches the filters', async () => {
      const admin = await makeAdmin('list-empty', ['support']);
      const subject = await createSubjectUser('list-empty');

      const body = await fetchPage(`userId=${subject.id}`, null, admin.headers);
      expect(body.items).toEqual([]);
      expect(body.nextCursor).toBeNull();
    });

    it('lists requests newest first with the owning user and never exposes exportKey', async () => {
      const admin = await makeAdmin('list-ok', ['support']);
      const subject = await createSubjectUser('list-ok');
      const base = Date.now();
      await createDataRequest({
        userId: subject.id,
        type: 'export',
        status: 'ready',
        requestedAt: new Date(base - 2000),
        exportKey: 'private/should-not-leak.zip',
      });
      const newer = await createDataRequest({
        userId: subject.id,
        type: 'delete',
        status: 'pending',
        requestedAt: new Date(base - 1000),
      });

      const body = await fetchPage(`userId=${subject.id}`, null, admin.headers);
      expect(body.items.length).toBe(2);
      expect(body.items[0]?.id).toBe(newer.id);
      expect(body.items.every((item) => item.user.id === subject.id)).toBe(true);
      expect(body.items.every((item) => item.user.email === subject.email)).toBe(true);
      expect(body.items.every((item) => !('exportKey' in item))).toBe(true);
      expect(JSON.stringify(body)).not.toContain('private/should-not-leak.zip');
    });

    it('filters by status', async () => {
      const admin = await makeAdmin('filter-status', ['support']);
      const subject = await createSubjectUser('filter-status');
      const base = Date.now();
      await createDataRequest({
        userId: subject.id,
        type: 'export',
        status: 'completed',
        requestedAt: new Date(base - 1000),
      });
      const pending = await createDataRequest({
        userId: subject.id,
        type: 'export',
        status: 'pending',
        requestedAt: new Date(base),
      });

      const body = await fetchPage(`userId=${subject.id}&status=pending`, null, admin.headers);
      expect(body.items.map((item) => item.id)).toEqual([pending.id]);
    });

    it('filters by type', async () => {
      const admin = await makeAdmin('filter-type', ['support']);
      const subject = await createSubjectUser('filter-type');
      const base = Date.now();
      await createDataRequest({
        userId: subject.id,
        type: 'export',
        status: 'pending',
        requestedAt: new Date(base - 1000),
      });
      const deletion = await createDataRequest({
        userId: subject.id,
        type: 'delete',
        status: 'pending',
        requestedAt: new Date(base),
      });

      const body = await fetchPage(`userId=${subject.id}&type=delete`, null, admin.headers);
      expect(body.items.map((item) => item.id)).toEqual([deletion.id]);
    });

    it('filters by channel', async () => {
      const admin = await makeAdmin('filter-channel', ['support']);
      const subject = await createSubjectUser('filter-channel');
      const base = Date.now();
      await createDataRequest({
        userId: subject.id,
        type: 'export',
        status: 'completed',
        requestedAt: new Date(base - 1000),
        channel: 'support',
      });
      const viaEmail = await createDataRequest({
        userId: subject.id,
        type: 'export',
        status: 'pending',
        requestedAt: new Date(base),
        channel: 'email',
      });

      const body = await fetchPage(`userId=${subject.id}&channel=email`, null, admin.headers);
      expect(body.items.map((item) => item.id)).toEqual([viaEmail.id]);
    });

    it('filters by userId', async () => {
      const admin = await makeAdmin('filter-user', ['support']);
      const subjectA = await createSubjectUser('filter-user-a');
      const subjectB = await createSubjectUser('filter-user-b');
      const base = Date.now();
      const requestA = await createDataRequest({
        userId: subjectA.id,
        type: 'export',
        status: 'pending',
        requestedAt: new Date(base - 1000),
      });
      await createDataRequest({
        userId: subjectB.id,
        type: 'export',
        status: 'pending',
        requestedAt: new Date(base),
      });

      const body = await fetchPage(`userId=${subjectA.id}`, null, admin.headers);
      expect(body.items.map((item) => item.id)).toEqual([requestA.id]);
    });

    it('paginates with no gaps or repeats', async () => {
      const admin = await makeAdmin('pagination', ['support']);
      const subject = await createSubjectUser('pagination');
      const base = Date.now();
      const created: string[] = [];
      for (let i = 0; i < 5; i += 1) {
        const row = await createDataRequest({
          userId: subject.id,
          type: 'export',
          status: 'completed',
          requestedAt: new Date(base - i * 1000),
        });
        created.push(row.id);
      }

      const items: DataRequestBody[] = [];
      let cursor: string | null = null;
      const query = `userId=${subject.id}&limit=2`;
      for (let page = 0; page < 40; page += 1) {
        const body = await fetchPage(query, cursor, admin.headers);
        expect(body.items.length).toBeLessThanOrEqual(2);
        items.push(...body.items);
        cursor = body.nextCursor;
        if (!cursor) break;
      }

      expect(items.length).toBe(5);
      const ids = items.map((item) => item.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids).toEqual(created);
    });

    it('breaks requestedAt ties by id when a tie spans a page boundary', async () => {
      const admin = await makeAdmin('pagination-ties', ['support']);
      const subject = await createSubjectUser('pagination-ties');
      const base = Date.now();
      const tieAt = new Date(base - 1000);

      const newer = await createDataRequest({
        userId: subject.id,
        type: 'export',
        status: 'completed',
        requestedAt: new Date(base),
      });
      const tied: string[] = [];
      for (let i = 0; i < 3; i += 1) {
        const row = await createDataRequest({
          userId: subject.id,
          type: 'export',
          status: 'completed',
          requestedAt: tieAt,
        });
        tied.push(row.id);
      }
      const older = await createDataRequest({
        userId: subject.id,
        type: 'export',
        status: 'completed',
        requestedAt: new Date(base - 2000),
      });

      const pages: DataRequestBody[][] = [];
      let cursor: string | null = null;
      const query = `userId=${subject.id}&limit=2`;
      for (let page = 0; page < 40; page += 1) {
        const body = await fetchPage(query, cursor, admin.headers);
        expect(body.items.length).toBeLessThanOrEqual(2);
        pages.push(body.items);
        cursor = body.nextCursor;
        if (!cursor) break;
      }

      const items = pages.flat();
      expect(items.length).toBe(5);
      const ids = items.map((item) => item.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(new Set(ids)).toEqual(new Set([newer.id, ...tied, older.id]));

      for (const [i, curr] of items.entries()) {
        if (i === 0) continue;
        const prev = items[i - 1];
        if (!prev) throw new Error(`missing item before index ${String(i)}`);
        const prevRequestedAt = new Date(prev.requestedAt).getTime();
        const currRequestedAt = new Date(curr.requestedAt).getTime();
        if (prevRequestedAt === currRequestedAt) {
          expect(prev.id > curr.id).toBe(true);
        } else {
          expect(prevRequestedAt).toBeGreaterThan(currRequestedAt);
        }
      }

      const tiedPageIndexes = new Set(
        pages.flatMap((pageItems, pageIndex) =>
          pageItems.filter((item) => tied.includes(item.id)).map(() => pageIndex),
        ),
      );
      expect(tiedPageIndexes.size).toBeGreaterThan(1);
    });

    describe('responseDueAt', () => {
      it('is set on a failed export with no later export', async () => {
        const admin = await makeAdmin('due-failed', ['support']);
        const subject = await createSubjectUser('due-failed');
        const requestedAt = new Date(Date.now() - 29 * 24 * 60 * 60 * 1000);
        const failed = await createDataRequest({
          userId: subject.id,
          type: 'export',
          status: 'failed',
          requestedAt,
          failureReason: 'export_failed',
        });

        const body = await fetchPage(`userId=${subject.id}`, null, admin.headers);
        const item = body.items.find((candidate) => candidate.id === failed.id);
        expect(item?.responseDueAt).toBe(
          gdprResponseDueAt(requestedAt, 'Europe/Luxembourg').toISOString(),
        );
      });

      it('is null on a failed export superseded by a later successful export', async () => {
        const admin = await makeAdmin('due-superseded', ['support']);
        const subject = await createSubjectUser('due-superseded');
        const base = Date.now();
        const failed = await createDataRequest({
          userId: subject.id,
          type: 'export',
          status: 'failed',
          requestedAt: new Date(base - 2000),
          failureReason: 'export_failed',
        });
        await createDataRequest({
          userId: subject.id,
          type: 'export',
          status: 'ready',
          requestedAt: new Date(base - 1000),
          expiresAt: new Date(base + 7 * 24 * 60 * 60 * 1000),
        });

        const body = await fetchPage(`userId=${subject.id}`, null, admin.headers);
        const item = body.items.find((candidate) => candidate.id === failed.id);
        expect(item?.responseDueAt).toBeNull();
      });

      it('is null on a ready export past its expiresAt: the download link answered the request', async () => {
        const admin = await makeAdmin('due-expired', ['support']);
        const subject = await createSubjectUser('due-expired');
        const requestedAt = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
        const expired = await createDataRequest({
          userId: subject.id,
          type: 'export',
          status: 'ready',
          requestedAt,
          expiresAt: new Date(Date.now() - 1000),
        });

        const body = await fetchPage(`userId=${subject.id}`, null, admin.headers);
        const item = body.items.find((candidate) => candidate.id === expired.id);
        expect(item?.responseDueAt).toBeNull();
      });

      it('is null on an earlier failed export superseded by a later ready export that has since expired', async () => {
        const admin = await makeAdmin('due-superseded-expired', ['support']);
        const subject = await createSubjectUser('due-superseded-expired');
        const base = Date.now();
        const failed = await createDataRequest({
          userId: subject.id,
          type: 'export',
          status: 'failed',
          requestedAt: new Date(base - 2000),
          failureReason: 'export_failed',
        });
        await createDataRequest({
          userId: subject.id,
          type: 'export',
          status: 'ready',
          requestedAt: new Date(base - 1000),
          expiresAt: new Date(base - 500),
        });

        const body = await fetchPage(`userId=${subject.id}`, null, admin.headers);
        const item = body.items.find((candidate) => candidate.id === failed.id);
        expect(item?.responseDueAt).toBeNull();
      });

      it('is set on a failed export superseded by an earlier successful export', async () => {
        const admin = await makeAdmin('due-earlier-success', ['support']);
        const subject = await createSubjectUser('due-earlier-success');
        const base = Date.now();
        await createDataRequest({
          userId: subject.id,
          type: 'export',
          status: 'ready',
          requestedAt: new Date(base - 2000),
          expiresAt: new Date(base + 7 * 24 * 60 * 60 * 1000),
        });
        const failed = await createDataRequest({
          userId: subject.id,
          type: 'export',
          status: 'failed',
          requestedAt: new Date(base - 1000),
          failureReason: 'export_failed',
        });

        const body = await fetchPage(`userId=${subject.id}`, null, admin.headers);
        const item = body.items.find((candidate) => candidate.id === failed.id);
        expect(item?.responseDueAt).toBe(
          gdprResponseDueAt(new Date(base - 1000), 'Europe/Luxembourg').toISOString(),
        );
      });

      it('is not cleared by a later export that is itself still pending', async () => {
        const admin = await makeAdmin('due-later-pending', ['support']);
        const subject = await createSubjectUser('due-later-pending');
        const base = Date.now();
        const failed = await createDataRequest({
          userId: subject.id,
          type: 'export',
          status: 'failed',
          requestedAt: new Date(base - 2000),
          failureReason: 'export_failed',
        });
        await createDataRequest({
          userId: subject.id,
          type: 'export',
          status: 'pending',
          requestedAt: new Date(base - 1000),
        });

        const body = await fetchPage(`userId=${subject.id}`, null, admin.headers);
        const item = body.items.find((candidate) => candidate.id === failed.id);
        expect(item?.responseDueAt).toBe(
          gdprResponseDueAt(new Date(base - 2000), 'Europe/Luxembourg').toISOString(),
        );
      });

      it('is null on a completed export', async () => {
        const admin = await makeAdmin('due-completed', ['support']);
        const subject = await createSubjectUser('due-completed');
        const completed = await createDataRequest({
          userId: subject.id,
          type: 'export',
          status: 'completed',
          requestedAt: new Date(),
        });

        const body = await fetchPage(`userId=${subject.id}`, null, admin.headers);
        const item = body.items.find((candidate) => candidate.id === completed.id);
        expect(item?.responseDueAt).toBeNull();
      });

      it('is null on a cancelled export', async () => {
        const admin = await makeAdmin('due-cancelled', ['support']);
        const subject = await createSubjectUser('due-cancelled');
        const cancelled = await createDataRequest({
          userId: subject.id,
          type: 'export',
          status: 'cancelled',
          requestedAt: new Date(),
        });

        const body = await fetchPage(`userId=${subject.id}`, null, admin.headers);
        const item = body.items.find((candidate) => candidate.id === cancelled.id);
        expect(item?.responseDueAt).toBeNull();
      });

      it('is computed independently for several awaiting users on the same page', async () => {
        const admin = await makeAdmin('due-multi-user', ['support']);
        const subjectA = await createSubjectUser('due-multi-user-a');
        const subjectB = await createSubjectUser('due-multi-user-b');
        const base = Date.now();
        const failedA = await createDataRequest({
          userId: subjectA.id,
          type: 'export',
          status: 'failed',
          requestedAt: new Date(base - 3000),
          failureReason: 'export_failed',
        });
        const failedB = await createDataRequest({
          userId: subjectB.id,
          type: 'export',
          status: 'failed',
          requestedAt: new Date(base - 2000),
          failureReason: 'export_failed',
        });
        await createDataRequest({
          userId: subjectB.id,
          type: 'export',
          status: 'ready',
          requestedAt: new Date(base - 1000),
          expiresAt: new Date(base + 7 * 24 * 60 * 60 * 1000),
        });

        const body = await fetchPage(`status=failed&type=export&limit=100`, null, admin.headers);
        const itemA = body.items.find((candidate) => candidate.id === failedA.id);
        const itemB = body.items.find((candidate) => candidate.id === failedB.id);
        expect(itemA?.responseDueAt).toBe(
          gdprResponseDueAt(new Date(base - 3000), 'Europe/Luxembourg').toISOString(),
        );
        expect(itemB?.responseDueAt).toBeNull();
      });

      it('is null on a ready export still downloadable', async () => {
        const admin = await makeAdmin('due-downloadable', ['support']);
        const subject = await createSubjectUser('due-downloadable');
        const ready = await createDataRequest({
          userId: subject.id,
          type: 'export',
          status: 'ready',
          requestedAt: new Date(),
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        });

        const body = await fetchPage(`userId=${subject.id}`, null, admin.headers);
        const item = body.items.find((candidate) => candidate.id === ready.id);
        expect(item?.responseDueAt).toBeNull();
      });

      it('is computed in the subject user country timezone, not always Europe/Luxembourg', async () => {
        const admin = await makeAdmin('due-country-tz', ['support']);
        const subject = await createSubjectUser(
          'due-country-tz',
          'active',
          requireFixtureCountryCode(),
        );
        const requestedAt = new Date('2026-01-29T15:30:00.000Z');
        const failed = await createDataRequest({
          userId: subject.id,
          type: 'export',
          status: 'failed',
          requestedAt,
          failureReason: 'export_failed',
        });

        const body = await fetchPage(`userId=${subject.id}`, null, admin.headers);
        const item = body.items.find((candidate) => candidate.id === failed.id);
        const expected = gdprResponseDueAt(requestedAt, FIXTURE_COUNTRY_TIMEZONE).toISOString();
        expect(expected).not.toBe(
          gdprResponseDueAt(requestedAt, 'Europe/Luxembourg').toISOString(),
        );
        expect(item?.responseDueAt).toBe(expected);
      });

      it('is null on a delete row', async () => {
        const admin = await makeAdmin('due-delete', ['support']);
        const subject = await createSubjectUser('due-delete');
        const deletion = await createDataRequest({
          userId: subject.id,
          type: 'delete',
          status: 'pending',
          requestedAt: new Date(),
        });

        const body = await fetchPage(`userId=${subject.id}`, null, admin.headers);
        const item = body.items.find((candidate) => candidate.id === deletion.id);
        expect(item?.responseDueAt).toBeNull();
      });

      it('is null when a later success falls after receivedAt even though it is before requestedAt', async () => {
        const admin = await makeAdmin('due-backdated-received-nulled', ['support']);
        const subject = await createSubjectUser('due-backdated-received-nulled');
        const base = Date.now();
        const receivedAt = new Date(base - 20 * 24 * 60 * 60 * 1000);
        const failed = await createDataRequest({
          userId: subject.id,
          type: 'export',
          status: 'failed',
          requestedAt: new Date(base - 1000),
          receivedAt,
          failureReason: 'export_failed',
        });
        await createDataRequest({
          userId: subject.id,
          type: 'export',
          status: 'ready',
          requestedAt: new Date(base - 10 * 24 * 60 * 60 * 1000),
          expiresAt: new Date(base + 7 * 24 * 60 * 60 * 1000),
        });

        const body = await fetchPage(`userId=${subject.id}`, null, admin.headers);
        const item = body.items.find((candidate) => candidate.id === failed.id);
        expect(item?.responseDueAt).toBeNull();
      });

      it('stays set when the later success is still before receivedAt', async () => {
        const admin = await makeAdmin('due-backdated-received-kept', ['support']);
        const subject = await createSubjectUser('due-backdated-received-kept');
        const base = Date.now();
        const receivedAt = new Date(base - 20 * 24 * 60 * 60 * 1000);
        const failed = await createDataRequest({
          userId: subject.id,
          type: 'export',
          status: 'failed',
          requestedAt: new Date(base - 1000),
          receivedAt,
          failureReason: 'export_failed',
        });
        await createDataRequest({
          userId: subject.id,
          type: 'export',
          status: 'ready',
          requestedAt: new Date(base - 25 * 24 * 60 * 60 * 1000),
          expiresAt: new Date(base + 7 * 24 * 60 * 60 * 1000),
        });

        const body = await fetchPage(`userId=${subject.id}`, null, admin.headers);
        const item = body.items.find((candidate) => candidate.id === failed.id);
        expect(item?.responseDueAt).toBe(
          gdprResponseDueAt(receivedAt, 'Europe/Luxembourg').toISOString(),
        );
      });
    });

    describe('answeredLate', () => {
      it('is true on a ready export completed after the due date, and responseDueAt stays null', async () => {
        const admin = await makeAdmin('late-ready', ['support']);
        const subject = await createSubjectUser('late-ready');
        const requestedAt = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
        const due = gdprResponseDueAt(requestedAt, 'Europe/Luxembourg');
        const ready = await createDataRequest({
          userId: subject.id,
          type: 'export',
          status: 'ready',
          requestedAt,
          completedAt: new Date(due.getTime() + 1),
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        });

        const body = await fetchPage(`userId=${subject.id}`, null, admin.headers);
        const item = body.items.find((candidate) => candidate.id === ready.id);
        expect(item?.answeredLate).toBe(true);
        expect(item?.responseDueAt).toBeNull();
      });

      it('is true on a ready export past its expiresAt that was completed after the due date, and responseDueAt stays null', async () => {
        const admin = await makeAdmin('late-ready-expired', ['support']);
        const subject = await createSubjectUser('late-ready-expired');
        const requestedAt = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
        const due = gdprResponseDueAt(requestedAt, 'Europe/Luxembourg');
        const expiredReady = await createDataRequest({
          userId: subject.id,
          type: 'export',
          status: 'ready',
          requestedAt,
          completedAt: new Date(due.getTime() + 1),
          expiresAt: new Date(Date.now() - 1000),
        });

        const body = await fetchPage(`userId=${subject.id}`, null, admin.headers);
        const item = body.items.find((candidate) => candidate.id === expiredReady.id);
        expect(item?.answeredLate).toBe(true);
        expect(item?.responseDueAt).toBeNull();
      });

      it('is true on a completed export completed after the due date, and responseDueAt stays null', async () => {
        const admin = await makeAdmin('late-completed', ['support']);
        const subject = await createSubjectUser('late-completed');
        const requestedAt = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
        const due = gdprResponseDueAt(requestedAt, 'Europe/Luxembourg');
        const completed = await createDataRequest({
          userId: subject.id,
          type: 'export',
          status: 'completed',
          requestedAt,
          completedAt: new Date(due.getTime() + 1),
        });

        const body = await fetchPage(`userId=${subject.id}`, null, admin.headers);
        const item = body.items.find((candidate) => candidate.id === completed.id);
        expect(item?.answeredLate).toBe(true);
        expect(item?.responseDueAt).toBeNull();
      });

      it('is false when completedAt exactly equals the due date', async () => {
        const admin = await makeAdmin('late-on-time', ['support']);
        const subject = await createSubjectUser('late-on-time');
        const requestedAt = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
        const due = gdprResponseDueAt(requestedAt, 'Europe/Luxembourg');
        const onTime = await createDataRequest({
          userId: subject.id,
          type: 'export',
          status: 'ready',
          requestedAt,
          completedAt: due,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        });

        const body = await fetchPage(`userId=${subject.id}`, null, admin.headers);
        const item = body.items.find((candidate) => candidate.id === onTime.id);
        expect(item?.answeredLate).toBe(false);
      });

      it('is false when completedAt is before the due date', async () => {
        const admin = await makeAdmin('late-early', ['support']);
        const subject = await createSubjectUser('late-early');
        const requestedAt = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
        const due = gdprResponseDueAt(requestedAt, 'Europe/Luxembourg');
        const early = await createDataRequest({
          userId: subject.id,
          type: 'export',
          status: 'ready',
          requestedAt,
          completedAt: new Date(due.getTime() - 1),
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        });

        const body = await fetchPage(`userId=${subject.id}`, null, admin.headers);
        const item = body.items.find((candidate) => candidate.id === early.id);
        expect(item?.answeredLate).toBe(false);
      });

      it('clamps the due date to the end of February for a January 31 request, and treats a completion one millisecond later as late', async () => {
        const admin = await makeAdmin('late-clamp-late', ['support']);
        const subject = await createSubjectUser('late-clamp-late');
        const requestedAt = new Date('2026-01-31T10:00:00.000Z');
        const due = gdprResponseDueAt(requestedAt, 'Europe/Luxembourg');
        expect(due.toISOString()).toBe('2026-02-28T10:00:00.000Z');
        const clamped = await createDataRequest({
          userId: subject.id,
          type: 'export',
          status: 'completed',
          requestedAt,
          completedAt: new Date(due.getTime() + 1),
        });

        const body = await fetchPage(`userId=${subject.id}`, null, admin.headers);
        const item = body.items.find((candidate) => candidate.id === clamped.id);
        expect(item?.answeredLate).toBe(true);
      });

      it('treats a completion at the exact clamped instant for a January 31 request as on time', async () => {
        const admin = await makeAdmin('late-clamp-on-time', ['support']);
        const subject = await createSubjectUser('late-clamp-on-time');
        const requestedAt = new Date('2026-01-31T10:00:00.000Z');
        const due = gdprResponseDueAt(requestedAt, 'Europe/Luxembourg');
        const clamped = await createDataRequest({
          userId: subject.id,
          type: 'export',
          status: 'completed',
          requestedAt,
          completedAt: due,
        });

        const body = await fetchPage(`userId=${subject.id}`, null, admin.headers);
        const item = body.items.find((candidate) => candidate.id === clamped.id);
        expect(item?.answeredLate).toBe(false);
      });

      it('is false on a delete row even with a late completedAt', async () => {
        const admin = await makeAdmin('late-delete', ['support']);
        const subject = await createSubjectUser('late-delete');
        const requestedAt = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
        const due = gdprResponseDueAt(requestedAt, 'Europe/Luxembourg');
        const deletion = await createDataRequest({
          userId: subject.id,
          type: 'delete',
          status: 'completed',
          requestedAt,
          completedAt: new Date(due.getTime() + 1),
        });

        const body = await fetchPage(`userId=${subject.id}`, null, admin.headers);
        const item = body.items.find((candidate) => candidate.id === deletion.id);
        expect(item?.answeredLate).toBe(false);
      });

      it('is false on a cancelled export even with a late completedAt', async () => {
        const admin = await makeAdmin('late-cancelled', ['support']);
        const subject = await createSubjectUser('late-cancelled');
        const requestedAt = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
        const due = gdprResponseDueAt(requestedAt, 'Europe/Luxembourg');
        const cancelled = await createDataRequest({
          userId: subject.id,
          type: 'export',
          status: 'cancelled',
          requestedAt,
          completedAt: new Date(due.getTime() + 1),
        });

        const body = await fetchPage(`userId=${subject.id}`, null, admin.headers);
        const item = body.items.find((candidate) => candidate.id === cancelled.id);
        expect(item?.answeredLate).toBe(false);
      });

      it.each(['pending', 'processing', 'failed'] as const)(
        'is false on a %s export even with a late completedAt',
        async (status) => {
          const admin = await makeAdmin(`late-${status}`, ['support']);
          const subject = await createSubjectUser(`late-${status}`);
          const requestedAt = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
          const due = gdprResponseDueAt(requestedAt, 'Europe/Luxembourg');
          const row = await createDataRequest({
            userId: subject.id,
            type: 'export',
            status,
            requestedAt,
            completedAt: new Date(due.getTime() + 1),
            ...(status === 'failed' ? { failureReason: 'export_failed' } : {}),
          });

          const body = await fetchPage(`userId=${subject.id}`, null, admin.headers);
          const item = body.items.find((candidate) => candidate.id === row.id);
          expect(item?.answeredLate).toBe(false);
        },
      );

      it.each(['ready', 'completed'] as const)(
        'is false on a %s export with a null completedAt',
        async (status) => {
          const admin = await makeAdmin(`late-null-${status}`, ['support']);
          const subject = await createSubjectUser(`late-null-${status}`);
          const row = await createDataRequest({
            userId: subject.id,
            type: 'export',
            status,
            requestedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
            ...(status === 'ready'
              ? { expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) }
              : {}),
          });

          const body = await fetchPage(`userId=${subject.id}`, null, admin.headers);
          const item = body.items.find((candidate) => candidate.id === row.id);
          expect(item?.answeredLate).toBe(false);
        },
      );

      it('is computed against the due date in the subject user country timezone', async () => {
        const admin = await makeAdmin('late-country-tz', ['support']);
        const subject = await createSubjectUser(
          'late-country-tz',
          'active',
          requireFixtureCountryCode(),
        );
        const requestedAt = new Date('2026-01-29T15:30:00.000Z');
        const dueInFixtureCountry = gdprResponseDueAt(requestedAt, FIXTURE_COUNTRY_TIMEZONE);
        const dueInLuxembourg = gdprResponseDueAt(requestedAt, 'Europe/Luxembourg');
        expect(dueInFixtureCountry.getTime()).toBeLessThan(dueInLuxembourg.getTime());
        const completedAt = new Date(dueInFixtureCountry.getTime() + 1);
        const completed = await createDataRequest({
          userId: subject.id,
          type: 'export',
          status: 'completed',
          requestedAt,
          completedAt,
        });

        const body = await fetchPage(`userId=${subject.id}`, null, admin.headers);
        const item = body.items.find((candidate) => candidate.id === completed.id);
        expect(item?.answeredLate).toBe(true);
      });
    });

    describe('answeredLate for a failed export later answered by a newer export', () => {
      it('is true when the retry completes after the failed request’s due date', async () => {
        const admin = await makeAdmin('late-retry-late', ['support']);
        const subject = await createSubjectUser('late-retry-late');
        const requestedAt = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
        const due = gdprResponseDueAt(requestedAt, 'Europe/Luxembourg');
        const failed = await createDataRequest({
          userId: subject.id,
          type: 'export',
          status: 'failed',
          requestedAt,
          failureReason: 'export_failed',
        });
        await createDataRequest({
          userId: subject.id,
          type: 'export',
          status: 'ready',
          requestedAt: new Date(requestedAt.getTime() + 1000),
          completedAt: new Date(due.getTime() + 1),
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        });

        const body = await fetchPage(`userId=${subject.id}`, null, admin.headers);
        const item = body.items.find((candidate) => candidate.id === failed.id);
        expect(item?.answeredLate).toBe(true);
      });

      it('is false when the retry completes on or before the failed request’s due date', async () => {
        const admin = await makeAdmin('late-retry-on-time', ['support']);
        const subject = await createSubjectUser('late-retry-on-time');
        const requestedAt = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
        const due = gdprResponseDueAt(requestedAt, 'Europe/Luxembourg');
        const failed = await createDataRequest({
          userId: subject.id,
          type: 'export',
          status: 'failed',
          requestedAt,
          failureReason: 'export_failed',
        });
        await createDataRequest({
          userId: subject.id,
          type: 'export',
          status: 'ready',
          requestedAt: new Date(requestedAt.getTime() + 1000),
          completedAt: due,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        });

        const body = await fetchPage(`userId=${subject.id}`, null, admin.headers);
        const item = body.items.find((candidate) => candidate.id === failed.id);
        expect(item?.answeredLate).toBe(false);
      });

      it('is false, and responseDueAt is non-null, when there is no later success', async () => {
        const admin = await makeAdmin('late-retry-none', ['support']);
        const subject = await createSubjectUser('late-retry-none');
        const requestedAt = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
        const due = gdprResponseDueAt(requestedAt, 'Europe/Luxembourg');
        const failed = await createDataRequest({
          userId: subject.id,
          type: 'export',
          status: 'failed',
          requestedAt,
          failureReason: 'export_failed',
        });

        const body = await fetchPage(`userId=${subject.id}`, null, admin.headers);
        const item = body.items.find((candidate) => candidate.id === failed.id);
        expect(item?.answeredLate).toBe(false);
        expect(item?.responseDueAt).toBe(due.toISOString());
      });

      it('is false when the only success is earlier than the failed request, not later', async () => {
        const admin = await makeAdmin('late-retry-earlier', ['support']);
        const subject = await createSubjectUser('late-retry-earlier');
        const base = Date.now() - 10 * 24 * 60 * 60 * 1000;
        await createDataRequest({
          userId: subject.id,
          type: 'export',
          status: 'ready',
          requestedAt: new Date(base - 1000),
          completedAt: new Date(base + 365 * 24 * 60 * 60 * 1000),
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        });
        const failed = await createDataRequest({
          userId: subject.id,
          type: 'export',
          status: 'failed',
          requestedAt: new Date(base),
          failureReason: 'export_failed',
        });

        const body = await fetchPage(`userId=${subject.id}`, null, admin.headers);
        const item = body.items.find((candidate) => candidate.id === failed.id);
        expect(item?.answeredLate).toBe(false);
      });

      it('uses the earliest later completedAt when several retries followed the failure', async () => {
        const admin = await makeAdmin('late-retry-earliest', ['support']);
        const subject = await createSubjectUser('late-retry-earliest');
        const requestedAt = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
        const due = gdprResponseDueAt(requestedAt, 'Europe/Luxembourg');
        const failed = await createDataRequest({
          userId: subject.id,
          type: 'export',
          status: 'failed',
          requestedAt,
          failureReason: 'export_failed',
        });
        await createDataRequest({
          userId: subject.id,
          type: 'export',
          status: 'completed',
          requestedAt: new Date(requestedAt.getTime() + 1000),
          completedAt: new Date(due.getTime() - 1),
        });
        await createDataRequest({
          userId: subject.id,
          type: 'export',
          status: 'ready',
          requestedAt: new Date(requestedAt.getTime() + 2000),
          completedAt: new Date(due.getTime() + 1),
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        });

        const body = await fetchPage(`userId=${subject.id}`, null, admin.headers);
        const item = body.items.find((candidate) => candidate.id === failed.id);
        expect(item?.answeredLate).toBe(false);
      });

      it('is false when the retry completes exactly on the due date (1ms before the late boundary)', async () => {
        const admin = await makeAdmin('late-retry-1ms-before', ['support']);
        const subject = await createSubjectUser('late-retry-1ms-before');
        const requestedAt = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
        const due = gdprResponseDueAt(requestedAt, 'Europe/Luxembourg');
        const failed = await createDataRequest({
          userId: subject.id,
          type: 'export',
          status: 'failed',
          requestedAt,
          failureReason: 'export_failed',
        });
        await createDataRequest({
          userId: subject.id,
          type: 'export',
          status: 'ready',
          requestedAt: new Date(requestedAt.getTime() + 1000),
          completedAt: new Date(due.getTime() - 1),
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        });

        const body = await fetchPage(`userId=${subject.id}`, null, admin.headers);
        const item = body.items.find((candidate) => candidate.id === failed.id);
        expect(item?.answeredLate).toBe(false);
      });

      it('is true when the retry completes 1ms after the due date', async () => {
        const admin = await makeAdmin('late-retry-1ms-after', ['support']);
        const subject = await createSubjectUser('late-retry-1ms-after');
        const requestedAt = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
        const due = gdprResponseDueAt(requestedAt, 'Europe/Luxembourg');
        const failed = await createDataRequest({
          userId: subject.id,
          type: 'export',
          status: 'failed',
          requestedAt,
          failureReason: 'export_failed',
        });
        await createDataRequest({
          userId: subject.id,
          type: 'export',
          status: 'ready',
          requestedAt: new Date(requestedAt.getTime() + 1000),
          completedAt: new Date(due.getTime() + 1),
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        });

        const body = await fetchPage(`userId=${subject.id}`, null, admin.headers);
        const item = body.items.find((candidate) => candidate.id === failed.id);
        expect(item?.answeredLate).toBe(true);
      });

      it('clamps the due date to the end of February for a January 31 request when checking a retry', async () => {
        const admin = await makeAdmin('late-retry-clamp', ['support']);
        const subject = await createSubjectUser('late-retry-clamp');
        const requestedAt = new Date('2026-01-31T10:00:00.000Z');
        const due = gdprResponseDueAt(requestedAt, 'Europe/Luxembourg');
        expect(due.toISOString()).toBe('2026-02-28T10:00:00.000Z');
        const failed = await createDataRequest({
          userId: subject.id,
          type: 'export',
          status: 'failed',
          requestedAt,
          failureReason: 'export_failed',
        });
        await createDataRequest({
          userId: subject.id,
          type: 'export',
          status: 'ready',
          requestedAt: new Date(requestedAt.getTime() + 1000),
          completedAt: new Date(due.getTime() + 1),
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        });

        const body = await fetchPage(`userId=${subject.id}`, null, admin.headers);
        const item = body.items.find((candidate) => candidate.id === failed.id);
        expect(item?.answeredLate).toBe(true);
      });

      it('is true when the retry’s requestedAt falls after receivedAt but before the failed request’s own requestedAt', async () => {
        const admin = await makeAdmin('late-retry-received-window', ['support']);
        const subject = await createSubjectUser('late-retry-received-window');
        const base = Date.now();
        const receivedAt = new Date(base - 20 * 24 * 60 * 60 * 1000);
        const requestedAt = new Date(base - 15 * 24 * 60 * 60 * 1000);
        const due = gdprResponseDueAt(receivedAt, 'Europe/Luxembourg');
        const failed = await createDataRequest({
          userId: subject.id,
          type: 'export',
          status: 'failed',
          requestedAt,
          receivedAt,
          failureReason: 'export_failed',
        });
        await createDataRequest({
          userId: subject.id,
          type: 'export',
          status: 'ready',
          requestedAt: new Date(receivedAt.getTime() + 1000),
          completedAt: new Date(due.getTime() + 1),
          expiresAt: new Date(base + 7 * 24 * 60 * 60 * 1000),
        });

        const body = await fetchPage(`userId=${subject.id}`, null, admin.headers);
        const item = body.items.find((candidate) => candidate.id === failed.id);
        expect(item?.answeredLate).toBe(true);
      });
    });
  });

  describe('POST /v1/admin/data-requests/:id/retry-export', () => {
    it('returns 401 when unauthenticated', async () => {
      const response = await fastify().inject({
        method: 'POST',
        url: `/v1/admin/data-requests/${randomUUID()}/retry-export`,
        headers: { origin: 'http://localhost:3000' },
      });
      expect(response.statusCode).toBe(401);
    });

    it('returns 403 for an admin without the support permission', async () => {
      const admin = await makeAdmin('retry-no-permission', ['finance']);
      const subject = await createSubjectUser('retry-no-permission');
      const failed = await createDataRequest({
        userId: subject.id,
        type: 'export',
        status: 'failed',
        requestedAt: new Date(),
        failureReason: 'export_failed',
      });

      const response = await fastify().inject({
        method: 'POST',
        url: `/v1/admin/data-requests/${failed.id}/retry-export`,
        headers: admin.headers,
      });
      expect(response.statusCode).toBe(403);
    });

    it('returns 404 for an unknown id', async () => {
      const admin = await makeAdmin('retry-not-found', ['support']);
      const response = await fastify().inject({
        method: 'POST',
        url: `/v1/admin/data-requests/${randomUUID()}/retry-export`,
        headers: admin.headers,
      });
      expect(response.statusCode).toBe(404);
    });

    it('returns 409 when the source request is not a failed export', async () => {
      const admin = await makeAdmin('retry-not-failed', ['support']);
      const subject = await createSubjectUser('retry-not-failed');
      const ready = await createDataRequest({
        userId: subject.id,
        type: 'export',
        status: 'ready',
        requestedAt: new Date(),
        completedAt: new Date(),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      });

      const response = await fastify().inject({
        method: 'POST',
        url: `/v1/admin/data-requests/${ready.id}/retry-export`,
        headers: admin.headers,
      });
      expect(response.statusCode).toBe(409);
      expect(response.json<{ code: string }>().code).toBe('EXPORT_NOT_FAILED');
    });

    it('returns 409 when the source request is a pending export', async () => {
      const admin = await makeAdmin('retry-pending', ['support']);
      const subject = await createSubjectUser('retry-pending');
      const pending = await createDataRequest({
        userId: subject.id,
        type: 'export',
        status: 'pending',
        requestedAt: new Date(),
      });

      const response = await fastify().inject({
        method: 'POST',
        url: `/v1/admin/data-requests/${pending.id}/retry-export`,
        headers: admin.headers,
      });
      expect(response.statusCode).toBe(409);
      expect(response.json<{ code: string }>().code).toBe('EXPORT_NOT_FAILED');
    });

    it('returns 409 when the source is a failed delete request, not an export', async () => {
      const admin = await makeAdmin('retry-wrong-type', ['support']);
      const subject = await createSubjectUser('retry-wrong-type');
      const failedDelete = await createDataRequest({
        userId: subject.id,
        type: 'delete',
        status: 'failed',
        requestedAt: new Date(),
        failureReason: 'delete_failed',
      });

      const response = await fastify().inject({
        method: 'POST',
        url: `/v1/admin/data-requests/${failedDelete.id}/retry-export`,
        headers: admin.headers,
      });
      expect(response.statusCode).toBe(409);
      expect(response.json<{ code: string }>().code).toBe('EXPORT_NOT_FAILED');
    });

    it('returns 409 when the user already has a pending or processing export', async () => {
      const admin = await makeAdmin('retry-already-open', ['support']);
      const subject = await createSubjectUser('retry-already-open');
      const failed = await createDataRequest({
        userId: subject.id,
        type: 'export',
        status: 'failed',
        requestedAt: new Date(Date.now() - 1000),
        failureReason: 'export_failed',
      });
      await createDataRequest({
        userId: subject.id,
        type: 'export',
        status: 'processing',
        requestedAt: new Date(),
      });

      const response = await fastify().inject({
        method: 'POST',
        url: `/v1/admin/data-requests/${failed.id}/retry-export`,
        headers: admin.headers,
      });
      expect(response.statusCode).toBe(409);
      expect(response.json<{ code: string }>().code).toBe('EXPORT_OPEN');
    });

    it('returns 409 when the user is suspended', async () => {
      const admin = await makeAdmin('retry-suspended', ['support']);
      const subject = await createSubjectUser('retry-suspended', 'suspended');
      const failed = await createDataRequest({
        userId: subject.id,
        type: 'export',
        status: 'failed',
        requestedAt: new Date(),
        failureReason: 'export_failed',
      });

      const response = await fastify().inject({
        method: 'POST',
        url: `/v1/admin/data-requests/${failed.id}/retry-export`,
        headers: admin.headers,
      });
      expect(response.statusCode).toBe(409);
      expect(response.json<{ code: string }>().code).toBe('USER_SUSPENDED');

      const createdRows = await prisma.dataRequest.findMany({
        where: { userId: subject.id, id: { not: failed.id } },
      });
      expect(createdRows).toHaveLength(0);
    });

    it('returns 409 when the user is soft-deleted and still in the grace period', async () => {
      const admin = await makeAdmin('retry-soft-deleted', ['support']);
      const subject = await createSubjectUser('retry-soft-deleted', 'deleted');
      const failed = await createDataRequest({
        userId: subject.id,
        type: 'export',
        status: 'failed',
        requestedAt: new Date(),
        failureReason: 'export_failed',
      });

      const response = await fastify().inject({
        method: 'POST',
        url: `/v1/admin/data-requests/${failed.id}/retry-export`,
        headers: admin.headers,
      });
      expect(response.statusCode).toBe(409);
      expect(response.json<{ code: string }>().code).toBe('USER_DELETED');

      const createdRows = await prisma.dataRequest.findMany({
        where: { userId: subject.id, id: { not: failed.id } },
      });
      expect(createdRows).toHaveLength(0);
    });

    it('returns 409 when the user has already been anonymised', async () => {
      const admin = await makeAdmin('retry-anonymised', ['support']);
      const subject = await createSubjectUser('retry-anonymised', 'deleted');
      await prisma.user.update({
        where: { id: subject.id },
        data: { email: `deleted-${subject.id}@deleted.invalid`, name: null, locale: 'en' },
      });
      const failed = await createDataRequest({
        userId: subject.id,
        type: 'export',
        status: 'failed',
        requestedAt: new Date(),
        failureReason: 'export_failed',
      });

      const response = await fastify().inject({
        method: 'POST',
        url: `/v1/admin/data-requests/${failed.id}/retry-export`,
        headers: admin.headers,
      });
      expect(response.statusCode).toBe(409);
      expect(response.json<{ code: string }>().code).toBe('USER_DELETED');

      const createdRows = await prisma.dataRequest.findMany({
        where: { userId: subject.id, id: { not: failed.id } },
      });
      expect(createdRows).toHaveLength(0);
    });

    it('returns 409 when this source has already been retried once', async () => {
      const admin = await makeAdmin('retry-already-retried', ['support']);
      const subject = await createSubjectUser('retry-already-retried');
      const failed = await createDataRequest({
        userId: subject.id,
        type: 'export',
        status: 'failed',
        requestedAt: new Date(Date.now() - 60_000),
        failureReason: 'export_failed',
      });

      const first = await fastify().inject({
        method: 'POST',
        url: `/v1/admin/data-requests/${failed.id}/retry-export`,
        headers: admin.headers,
      });
      expect(first.statusCode).toBe(201);

      const second = await fastify().inject({
        method: 'POST',
        url: `/v1/admin/data-requests/${failed.id}/retry-export`,
        headers: admin.headers,
      });
      expect(second.statusCode).toBe(409);
      expect(second.json<{ code: string }>().code).toBe('EXPORT_ALREADY_RETRIED');

      const createdRows = await prisma.dataRequest.findMany({
        where: { userId: subject.id, id: { not: failed.id } },
      });
      expect(createdRows).toHaveLength(1);
    });

    it('returns 409 when the user already holds a later export answering the request', async () => {
      const admin = await makeAdmin('retry-already-answered', ['support']);
      const subject = await createSubjectUser('retry-already-answered');
      const failed = await createDataRequest({
        userId: subject.id,
        type: 'export',
        status: 'failed',
        requestedAt: new Date(Date.now() - 60_000),
        failureReason: 'export_failed',
      });
      await createDataRequest({
        userId: subject.id,
        type: 'export',
        status: 'ready',
        requestedAt: new Date(),
        completedAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
        exportKey: 'exports/retry-already-answered.zip',
      });

      const response = await fastify().inject({
        method: 'POST',
        url: `/v1/admin/data-requests/${failed.id}/retry-export`,
        headers: admin.headers,
      });
      expect(response.statusCode).toBe(409);
      expect(response.json<{ code: string }>().code).toBe('EXPORT_ALREADY_ANSWERED');

      const createdRows = await prisma.dataRequest.findMany({
        where: { userId: subject.id, id: { not: failed.id } },
      });
      expect(createdRows).toHaveLength(1);
    });

    it('creates a new pending export, enqueues it, and writes an audit row', async () => {
      const admin = await makeAdmin('retry-ok', ['support']);
      const subject = await createSubjectUser('retry-ok');
      const failed = await createDataRequest({
        userId: subject.id,
        type: 'export',
        status: 'failed',
        requestedAt: new Date(Date.now() - 60_000),
        failureReason: 'export_failed',
      });

      const response = await fastify().inject({
        method: 'POST',
        url: `/v1/admin/data-requests/${failed.id}/retry-export`,
        headers: admin.headers,
        remoteAddress: FAKE_IP,
      });
      expect(response.statusCode).toBe(201);
      const body = response.json<DataRequestBody>();
      expect(body.id).not.toBe(failed.id);
      expect(body.type).toBe('export');
      expect(body.status).toBe('pending');
      expect(body.user.id).toBe(subject.id);

      const created = await prisma.dataRequest.findUnique({ where: { id: body.id } });
      expect(created?.userId).toBe(subject.id);
      expect(created?.type).toBe('export');
      expect(created?.status).toBe('pending');

      const auditRow = await prisma.auditLog.findFirst({
        where: { action: 'data_request.export_retried', targetId: body.id },
      });
      expect(auditRow).not.toBeNull();
      expect(auditRow?.actorType).toBe('admin');
      expect(auditRow?.actorId).toBe(admin.id);
      expect(auditRow?.targetType).toBe('DataRequest');
      expect(auditRow?.before).toEqual({ sourceId: failed.id });
      expect(auditRow?.after).toEqual({ status: 'pending', userId: subject.id });
      expect(auditRow?.ip).toBe(FAKE_IP);

      const enqueuedJob = await exportQueue.getJob(body.id);
      expect(enqueuedJob).not.toBeNull();
      expect(enqueuedJob?.data).toEqual({ dataRequestId: body.id });
    });

    it('marks the new row failed and rethrows when enqueueing it fails', async () => {
      const admin = await makeAdmin('retry-enqueue-fails', ['support']);
      const subject = await createSubjectUser('retry-enqueue-fails');
      const failed = await createDataRequest({
        userId: subject.id,
        type: 'export',
        status: 'failed',
        requestedAt: new Date(Date.now() - 60_000),
        failureReason: 'export_failed',
      });

      const queueService = app.get(GdprExportQueueService);
      const originalAdd = queueService.queue.add.bind(queueService.queue);
      queueService.queue.add = (() => {
        throw new Error('simulated enqueue failure');
      }) as typeof queueService.queue.add;

      let response;
      try {
        response = await fastify().inject({
          method: 'POST',
          url: `/v1/admin/data-requests/${failed.id}/retry-export`,
          headers: admin.headers,
        });
      } finally {
        queueService.queue.add = originalAdd;
      }
      expect(response.statusCode).toBe(500);

      const createdRows = await prisma.dataRequest.findMany({
        where: { userId: subject.id, id: { not: failed.id } },
      });
      expect(createdRows).toHaveLength(1);
      const createdRow = createdRows[0];
      expect(createdRow).toBeDefined();
      if (!createdRow) throw new Error('expected the retried row to exist');
      expect(createdRow.status).toBe('failed');
      expect(createdRow.failureReason).toBe('enqueue_failed');

      const retryResponse = await fastify().inject({
        method: 'POST',
        url: `/v1/admin/data-requests/${createdRow.id}/retry-export`,
        headers: admin.headers,
      });
      expect(retryResponse.statusCode).toBe(201);
      const retryBody = retryResponse.json<DataRequestBody>();
      expect(retryBody.status).toBe('pending');

      const enqueuedJob = await exportQueue.getJob(retryBody.id);
      expect(enqueuedJob).not.toBeNull();
      expect(enqueuedJob?.data).toEqual({ dataRequestId: retryBody.id });
    });

    it('lets only one of two concurrent retries for the same source succeed', async () => {
      const admin = await makeAdmin('retry-concurrent', ['support']);
      const subject = await createSubjectUser('retry-concurrent');
      const failed = await createDataRequest({
        userId: subject.id,
        type: 'export',
        status: 'failed',
        requestedAt: new Date(Date.now() - 60_000),
        failureReason: 'export_failed',
      });

      const [first, second] = await Promise.all([
        fastify().inject({
          method: 'POST',
          url: `/v1/admin/data-requests/${failed.id}/retry-export`,
          headers: admin.headers,
        }),
        fastify().inject({
          method: 'POST',
          url: `/v1/admin/data-requests/${failed.id}/retry-export`,
          headers: admin.headers,
        }),
      ]);
      const statusCodes = [first.statusCode, second.statusCode].sort();
      expect(statusCodes).toEqual([201, 409]);
      const loser = first.statusCode === 409 ? first : second;
      // The loser can be caught by the findRetryAuditForSource pre-check or by
      // the unique-index race inside the transaction, depending on how far it
      // got before the winner committed.
      expect(['EXPORT_OPEN', 'EXPORT_ALREADY_RETRIED']).toContain(
        loser.json<{ code: string }>().code,
      );

      const createdRows = await prisma.dataRequest.findMany({
        where: { userId: subject.id, id: { not: failed.id } },
      });
      expect(createdRows).toHaveLength(1);
    });
  });

  describe('POST /v1/admin/data-requests', () => {
    it('returns 401 when unauthenticated', async () => {
      const subject = await createSubjectUser('log-unauth');
      const response = await fastify().inject({
        method: 'POST',
        url: '/v1/admin/data-requests',
        headers: { origin: 'http://localhost:3000' },
        payload: {
          userId: subject.id,
          type: 'export',
          channel: 'email',
          receivedAt: new Date().toISOString(),
        },
      });
      expect(response.statusCode).toBe(401);
    });

    it('returns 403 for an admin without the support permission', async () => {
      const admin = await makeAdmin('log-no-permission', ['finance']);
      const subject = await createSubjectUser('log-no-permission');
      const response = await fastify().inject({
        method: 'POST',
        url: '/v1/admin/data-requests',
        headers: admin.headers,
        payload: {
          userId: subject.id,
          type: 'export',
          channel: 'email',
          receivedAt: new Date().toISOString(),
        },
      });
      expect(response.statusCode).toBe(403);
    });

    it('returns 404 for an unknown user', async () => {
      const admin = await makeAdmin('log-unknown-user', ['support']);
      const response = await fastify().inject({
        method: 'POST',
        url: '/v1/admin/data-requests',
        headers: admin.headers,
        payload: {
          userId: randomUUID(),
          type: 'export',
          channel: 'email',
          receivedAt: new Date().toISOString(),
        },
      });
      expect(response.statusCode).toBe(404);
      const body = response.json<{ code: string; message: string }>();
      expect(body.code).toBe('NOT_FOUND');
      expect(body.message).toBe('User not found');
    });

    it('returns 400 when receivedAt is more than a minute in the future', async () => {
      const admin = await makeAdmin('log-future', ['support']);
      const subject = await createSubjectUser('log-future');
      const response = await fastify().inject({
        method: 'POST',
        url: '/v1/admin/data-requests',
        headers: admin.headers,
        payload: {
          userId: subject.id,
          type: 'export',
          channel: 'email',
          receivedAt: new Date(Date.now() + 120_000).toISOString(),
        },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json<{ code: string }>().code).toBe('VALIDATION_ERROR');

      const rows = await prisma.dataRequest.findMany({ where: { userId: subject.id } });
      expect(rows).toHaveLength(0);
    });

    it('accepts receivedAt safely inside the future skew allowance', async () => {
      const admin = await makeAdmin('log-future-ok', ['support']);
      const subject = await createSubjectUser('log-future-ok');
      const response = await fastify().inject({
        method: 'POST',
        url: '/v1/admin/data-requests',
        headers: admin.headers,
        payload: {
          userId: subject.id,
          type: 'export',
          channel: 'email',
          receivedAt: new Date(Date.now() + 30_000).toISOString(),
        },
      });
      expect(response.statusCode).toBe(201);
    });

    it('returns 400 when receivedAt is more than 30 days in the past', async () => {
      const admin = await makeAdmin('log-too-old', ['support']);
      const subject = await createSubjectUser('log-too-old');
      const response = await fastify().inject({
        method: 'POST',
        url: '/v1/admin/data-requests',
        headers: admin.headers,
        payload: {
          userId: subject.id,
          type: 'export',
          channel: 'email',
          receivedAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString(),
        },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json<{ code: string }>().code).toBe('VALIDATION_ERROR');

      const rows = await prisma.dataRequest.findMany({ where: { userId: subject.id } });
      expect(rows).toHaveLength(0);
    });

    it('accepts receivedAt safely inside the 30 day age allowance', async () => {
      const admin = await makeAdmin('log-old-ok', ['support']);
      const subject = await createSubjectUser('log-old-ok');
      const response = await fastify().inject({
        method: 'POST',
        url: '/v1/admin/data-requests',
        headers: admin.headers,
        payload: {
          userId: subject.id,
          type: 'export',
          channel: 'email',
          receivedAt: new Date(Date.now() - 29 * 24 * 60 * 60 * 1000).toISOString(),
        },
      });
      expect(response.statusCode).toBe(201);
    });

    it('returns 409 EXPORT_OPEN when the user already has an open export request', async () => {
      const admin = await makeAdmin('log-export-open', ['support']);
      const subject = await createSubjectUser('log-export-open');
      await createDataRequest({
        userId: subject.id,
        type: 'export',
        status: 'pending',
        requestedAt: new Date(),
      });

      const response = await fastify().inject({
        method: 'POST',
        url: '/v1/admin/data-requests',
        headers: admin.headers,
        payload: {
          userId: subject.id,
          type: 'export',
          channel: 'email',
          receivedAt: new Date().toISOString(),
        },
      });
      expect(response.statusCode).toBe(409);
      expect(response.json<{ code: string }>().code).toBe('EXPORT_OPEN');

      const rows = await prisma.dataRequest.findMany({ where: { userId: subject.id } });
      expect(rows).toHaveLength(1);
    });

    it('returns 409 DELETE_OPEN when the user already has an open deletion request', async () => {
      const admin = await makeAdmin('log-delete-open', ['support']);
      const subject = await createSubjectUser('log-delete-open');
      await createDataRequest({
        userId: subject.id,
        type: 'delete',
        status: 'pending',
        requestedAt: new Date(),
      });

      const response = await fastify().inject({
        method: 'POST',
        url: '/v1/admin/data-requests',
        headers: admin.headers,
        payload: {
          userId: subject.id,
          type: 'delete',
          channel: 'email',
          receivedAt: new Date().toISOString(),
        },
      });
      expect(response.statusCode).toBe(409);
      expect(response.json<{ code: string }>().code).toBe('DELETE_OPEN');

      const rows = await prisma.dataRequest.findMany({ where: { userId: subject.id } });
      expect(rows).toHaveLength(1);
    });

    it('returns 409 USER_SUSPENDED for a suspended user', async () => {
      const admin = await makeAdmin('log-suspended', ['support']);
      const subject = await createSubjectUser('log-suspended', 'suspended');

      const response = await fastify().inject({
        method: 'POST',
        url: '/v1/admin/data-requests',
        headers: admin.headers,
        payload: {
          userId: subject.id,
          type: 'export',
          channel: 'email',
          receivedAt: new Date().toISOString(),
        },
      });
      expect(response.statusCode).toBe(409);
      expect(response.json<{ code: string }>().code).toBe('USER_SUSPENDED');

      const rows = await prisma.dataRequest.findMany({ where: { userId: subject.id } });
      expect(rows).toHaveLength(0);
    });

    it('returns 409 USER_DELETED for an already deleted user', async () => {
      const admin = await makeAdmin('log-deleted', ['support']);
      const subject = await createSubjectUser('log-deleted', 'deleted');

      const response = await fastify().inject({
        method: 'POST',
        url: '/v1/admin/data-requests',
        headers: admin.headers,
        payload: {
          userId: subject.id,
          type: 'delete',
          channel: 'support',
          receivedAt: new Date().toISOString(),
        },
      });
      expect(response.statusCode).toBe(409);
      expect(response.json<{ code: string }>().code).toBe('USER_DELETED');

      const rows = await prisma.dataRequest.findMany({ where: { userId: subject.id } });
      expect(rows).toHaveLength(0);
    });

    it('returns 409 BLOCKING_OBLIGATIONS when a verification case is in review', async () => {
      const admin = await makeAdmin('log-blocked-verification', ['support']);
      const subject = await createSubjectUser('log-blocked-verification');
      await prisma.verificationCase.create({
        data: { userId: subject.id, countryCode: 'LU', status: 'in_review' },
      });

      const response = await fastify().inject({
        method: 'POST',
        url: '/v1/admin/data-requests',
        headers: admin.headers,
        payload: {
          userId: subject.id,
          type: 'delete',
          channel: 'support',
          receivedAt: new Date().toISOString(),
        },
      });
      expect(response.statusCode).toBe(409);
      const errorBody = response.json<{ code: string; details?: { reason?: string } }>();
      expect(errorBody.code).toBe('BLOCKING_OBLIGATIONS');
      expect(errorBody.details?.reason).toBe('VERIFICATION_IN_REVIEW');

      const user = await prisma.user.findUniqueOrThrow({ where: { id: subject.id } });
      expect(user.status).toBe('active');
      const rows = await prisma.dataRequest.findMany({ where: { userId: subject.id } });
      expect(rows).toHaveLength(0);
    });

    it('returns 403 PROTECTED_TARGET when the admin targets themselves', async () => {
      const admin = await makeAdmin('protected-self', ['support']);

      const response = await fastify().inject({
        method: 'POST',
        url: '/v1/admin/data-requests',
        headers: admin.headers,
        payload: {
          userId: admin.id,
          type: 'export',
          channel: 'email',
          receivedAt: new Date().toISOString(),
        },
      });
      expect(response.statusCode).toBe(403);
      expect(response.json<{ code: string }>().code).toBe('PROTECTED_TARGET');

      const rows = await prisma.dataRequest.findMany({ where: { userId: admin.id } });
      expect(rows).toHaveLength(0);
    });

    it('returns 403 PROTECTED_TARGET when the target has the admin role', async () => {
      const admin = await makeAdmin('protected-admin-role-actor', ['support']);
      const target = await createSubjectUser('protected-admin-role-target');
      await prisma.user.update({ where: { id: target.id }, data: { roles: ['admin'] } });

      const response = await fastify().inject({
        method: 'POST',
        url: '/v1/admin/data-requests',
        headers: admin.headers,
        payload: {
          userId: target.id,
          type: 'export',
          channel: 'email',
          receivedAt: new Date().toISOString(),
        },
      });
      expect(response.statusCode).toBe(403);
      expect(response.json<{ code: string }>().code).toBe('PROTECTED_TARGET');

      const rows = await prisma.dataRequest.findMany({ where: { userId: target.id } });
      expect(rows).toHaveLength(0);
    });

    it('returns 403 PROTECTED_TARGET when the target holds an admin permission grant', async () => {
      const admin = await makeAdmin('protected-grant-actor', ['support']);
      const target = await createSubjectUser('protected-grant-target');
      await prisma.adminPermissionGrant.create({
        data: { userId: target.id, permission: 'finance', grantedByAdminId: admin.id },
      });

      const response = await fastify().inject({
        method: 'POST',
        url: '/v1/admin/data-requests',
        headers: admin.headers,
        payload: {
          userId: target.id,
          type: 'export',
          channel: 'email',
          receivedAt: new Date().toISOString(),
        },
      });
      expect(response.statusCode).toBe(403);
      expect(response.json<{ code: string }>().code).toBe('PROTECTED_TARGET');

      const rows = await prisma.dataRequest.findMany({ where: { userId: target.id } });
      expect(rows).toHaveLength(0);
    });

    it('lets a superadmin with fresh 2FA target an otherwise protected user', async () => {
      const admin = await makeAdmin('protected-bypass-actor', ['support', 'superadmin']);
      const target = await createSubjectUser('protected-bypass-target');
      await prisma.adminPermissionGrant.create({
        data: { userId: target.id, permission: 'finance', grantedByAdminId: admin.id },
      });

      const response = await fastify().inject({
        method: 'POST',
        url: '/v1/admin/data-requests',
        headers: admin.headers,
        payload: {
          userId: target.id,
          type: 'export',
          channel: 'email',
          receivedAt: new Date().toISOString(),
        },
      });
      expect(response.statusCode).toBe(201);

      const rows = await prisma.dataRequest.findMany({ where: { userId: target.id } });
      expect(rows).toHaveLength(1);
    });

    it('returns 403 PROTECTED_TARGET when a superadmin with fresh 2FA logs an export for themselves', async () => {
      const admin = await makeAdmin('protected-superadmin-self-export', ['support', 'superadmin']);
      const response = await fastify().inject({
        method: 'POST',
        url: '/v1/admin/data-requests',
        headers: admin.headers,
        payload: {
          userId: admin.id,
          type: 'export',
          channel: 'email',
          receivedAt: new Date().toISOString(),
        },
      });
      expect(response.statusCode).toBe(403);
      expect(response.json<{ code: string }>().code).toBe('PROTECTED_TARGET');

      const rows = await prisma.dataRequest.findMany({ where: { userId: admin.id } });
      expect(rows).toHaveLength(0);
    });

    it('returns 403 PROTECTED_TARGET when a superadmin with fresh 2FA logs a delete for themselves', async () => {
      const admin = await makeAdmin('protected-superadmin-self-delete', ['support', 'superadmin']);
      const response = await fastify().inject({
        method: 'POST',
        url: '/v1/admin/data-requests',
        headers: admin.headers,
        payload: {
          userId: admin.id,
          type: 'delete',
          channel: 'email',
          receivedAt: new Date().toISOString(),
        },
      });
      expect(response.statusCode).toBe(403);
      expect(response.json<{ code: string }>().code).toBe('PROTECTED_TARGET');

      const rows = await prisma.dataRequest.findMany({ where: { userId: admin.id } });
      expect(rows).toHaveLength(0);
    });

    it('returns 403 TWO_FACTOR_REQUIRED for a delete logged without a fresh second factor', async () => {
      const admin = await makeAdmin('delete-stale-2fa', ['support']);
      await prisma.session.updateMany({
        where: { userId: admin.id },
        data: { twoFactorVerifiedAt: new Date(Date.now() - 20 * 60 * 1000) },
      });
      const subject = await createSubjectUser('delete-stale-2fa-target');

      const response = await fastify().inject({
        method: 'POST',
        url: '/v1/admin/data-requests',
        headers: admin.headers,
        payload: {
          userId: subject.id,
          type: 'delete',
          channel: 'support',
          receivedAt: new Date().toISOString(),
        },
      });
      expect(response.statusCode).toBe(403);
      expect(response.json<{ code: string }>().code).toBe('TWO_FACTOR_REQUIRED');

      const user = await prisma.user.findUniqueOrThrow({ where: { id: subject.id } });
      expect(user.status).toBe('active');
      const rows = await prisma.dataRequest.findMany({ where: { userId: subject.id } });
      expect(rows).toHaveLength(0);
    });

    it('rate-limits deletes more strictly than other offline mutations', async () => {
      const admin = await makeAdmin('delete-rate-limit', ['support']);
      const subjects = await Promise.all(
        Array.from({ length: 6 }, (_, index) =>
          createSubjectUser(`delete-rate-limit-${String(index)}`),
        ),
      );

      for (const subject of subjects.slice(0, 5)) {
        const response = await fastify().inject({
          method: 'POST',
          url: '/v1/admin/data-requests',
          headers: admin.headers,
          payload: {
            userId: subject.id,
            type: 'delete',
            channel: 'support',
            receivedAt: new Date().toISOString(),
          },
        });
        expect(response.statusCode).toBe(201);
      }

      const overflowSubject = subjects[5];
      if (!overflowSubject) throw new Error('expected a sixth subject');
      const overflow = await fastify().inject({
        method: 'POST',
        url: '/v1/admin/data-requests',
        headers: admin.headers,
        payload: {
          userId: overflowSubject.id,
          type: 'delete',
          channel: 'support',
          receivedAt: new Date().toISOString(),
        },
      });
      expect(overflow.statusCode).toBe(429);
      expect(overflow.json<{ code: string }>().code).toBe('TOO_MANY_REQUESTS');
    });

    describe('export', () => {
      it.each(['email', 'support'] as const)(
        'creates a pending export logged over %s, enqueues it, and writes an audit row',
        async (channel) => {
          const admin = await makeAdmin(`log-export-ok-${channel}`, ['support']);
          const subject = await createSubjectUser(`log-export-ok-${channel}`);
          const receivedAt = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);

          const response = await fastify().inject({
            method: 'POST',
            url: '/v1/admin/data-requests',
            headers: admin.headers,
            remoteAddress: FAKE_IP,
            payload: {
              userId: subject.id,
              type: 'export',
              channel,
              receivedAt: receivedAt.toISOString(),
            },
          });
          expect(response.statusCode).toBe(201);
          const body = response.json<DataRequestBody>();
          expect(body.type).toBe('export');
          expect(body.status).toBe('pending');
          expect(body.channel).toBe(channel);
          expect(body.user.id).toBe(subject.id);
          expect(body.answeredLate).toBe(false);
          expect(body.responseDueAt).toBe(
            gdprResponseDueAt(receivedAt, 'Europe/Luxembourg').toISOString(),
          );
          expect(body.receivedAt).toBe(receivedAt.toISOString());
          expect(Date.now() - new Date(body.requestedAt).getTime()).toBeLessThan(10_000);

          const created = await prisma.dataRequest.findUnique({ where: { id: body.id } });
          expect(created?.userId).toBe(subject.id);
          expect(created?.type).toBe('export');
          expect(created?.status).toBe('pending');
          expect(created?.channel).toBe(channel);
          expect(created?.receivedAt.toISOString()).toBe(receivedAt.toISOString());
          expect(Date.now() - (created?.requestedAt.getTime() ?? 0)).toBeLessThan(10_000);

          const auditRow = await prisma.auditLog.findFirst({
            where: { action: 'data_request.logged_offline', targetId: body.id },
          });
          expect(auditRow).not.toBeNull();
          expect(auditRow?.actorType).toBe('admin');
          expect(auditRow?.actorId).toBe(admin.id);
          expect(auditRow?.targetType).toBe('DataRequest');
          expect(auditRow?.before).toBeNull();
          expect(auditRow?.after).toEqual({
            type: 'export',
            channel,
            receivedAt: receivedAt.toISOString(),
            userId: subject.id,
          });
          expect(auditRow?.ip).toBe(FAKE_IP);

          const enqueuedJob = await exportQueue.getJob(body.id);
          expect(enqueuedJob).not.toBeNull();
          expect(enqueuedJob?.data).toEqual({ dataRequestId: body.id });
        },
      );

      it('marks the new row failed and rethrows when enqueueing it fails', async () => {
        const admin = await makeAdmin('log-export-enqueue-fails', ['support']);
        const subject = await createSubjectUser('log-export-enqueue-fails');

        const queueService = app.get(GdprExportQueueService);
        const originalAdd = queueService.queue.add.bind(queueService.queue);
        queueService.queue.add = (() => {
          throw new Error('simulated enqueue failure');
        }) as typeof queueService.queue.add;

        let response;
        try {
          response = await fastify().inject({
            method: 'POST',
            url: '/v1/admin/data-requests',
            headers: admin.headers,
            payload: {
              userId: subject.id,
              type: 'export',
              channel: 'email',
              receivedAt: new Date().toISOString(),
            },
          });
        } finally {
          queueService.queue.add = originalAdd;
        }
        expect(response.statusCode).toBe(500);

        const createdRows = await prisma.dataRequest.findMany({ where: { userId: subject.id } });
        expect(createdRows).toHaveLength(1);
        const createdRow = createdRows[0];
        expect(createdRow).toBeDefined();
        if (!createdRow) throw new Error('expected the logged row to exist');
        expect(createdRow.status).toBe('failed');
        expect(createdRow.failureReason).toBe('enqueue_failed');

        const failureAuditRow = await prisma.auditLog.findFirst({
          where: { action: 'data_request.export_failed', targetId: createdRow.id },
        });
        expect(failureAuditRow).not.toBeNull();
        expect(failureAuditRow?.after).toEqual({ status: 'failed', reason: 'enqueue_failed' });
      });

      it('lets only one of two concurrent offline export logs for the same user succeed', async () => {
        const admin = await makeAdmin('log-export-concurrent', ['support']);
        const subject = await createSubjectUser('log-export-concurrent');

        const payload = {
          userId: subject.id,
          type: 'export' as const,
          channel: 'email' as const,
          receivedAt: new Date().toISOString(),
        };

        const [first, second] = await Promise.all([
          fastify().inject({
            method: 'POST',
            url: '/v1/admin/data-requests',
            headers: admin.headers,
            payload,
          }),
          fastify().inject({
            method: 'POST',
            url: '/v1/admin/data-requests',
            headers: admin.headers,
            payload,
          }),
        ]);
        const statusCodes = [first.statusCode, second.statusCode].sort();
        expect(statusCodes).toEqual([201, 409]);
        const loser = first.statusCode === 409 ? first : second;
        expect(loser.json<{ code: string }>().code).toBe('EXPORT_OPEN');

        const rows = await prisma.dataRequest.findMany({ where: { userId: subject.id } });
        expect(rows).toHaveLength(1);
      });
    });

    describe('delete', () => {
      it('soft-deletes the user, clears sessions, and writes an audit row with the channel', async () => {
        const admin = await makeAdmin('log-delete-ok', ['support']);
        const subject = await createSubjectUser('log-delete-ok');
        await prisma.session.create({
          data: {
            userId: subject.id,
            tokenHash: randomUUID(),
            expiresAt: new Date(Date.now() + 60 * 60 * 1000),
          },
        });
        const receivedAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);

        const response = await fastify().inject({
          method: 'POST',
          url: '/v1/admin/data-requests',
          headers: admin.headers,
          remoteAddress: FAKE_IP,
          payload: {
            userId: subject.id,
            type: 'delete',
            channel: 'support',
            receivedAt: receivedAt.toISOString(),
          },
        });
        expect(response.statusCode).toBe(201);
        const body = response.json<DataRequestBody>();
        expect(body.type).toBe('delete');
        expect(body.status).toBe('pending');
        expect(body.channel).toBe('support');
        expect(body.responseDueAt).toBeNull();
        expect(body.answeredLate).toBe(false);

        const user = await prisma.user.findUniqueOrThrow({ where: { id: subject.id } });
        expect(user.status).toBe('deleted');
        expect(user.deletedAt).not.toBeNull();

        const sessions = await prisma.session.findMany({ where: { userId: subject.id } });
        expect(sessions).toHaveLength(0);

        const auditRow = await prisma.auditLog.findFirst({
          where: { action: 'data_request.logged_offline', targetId: body.id },
        });
        expect(auditRow).not.toBeNull();
        expect(auditRow?.actorType).toBe('admin');
        expect(auditRow?.actorId).toBe(admin.id);
        expect(auditRow?.targetType).toBe('DataRequest');
        expect(auditRow?.before).toEqual({ userStatus: 'active', profileIsPublished: null });
        expect(auditRow?.after).toEqual({
          userStatus: 'deleted',
          cancelledRequestIds: [],
          declinedQuoteIds: [],
          withdrawnQuoteIds: [],
          closedJobOfferIds: [],
          withdrawnJobApplicationIds: [],
          channel: 'support',
          receivedAt: receivedAt.toISOString(),
        });
        expect(auditRow?.ip).toBe(FAKE_IP);
      });

      it('revokes sessions and devices when logging an offline deletion', async () => {
        const admin = await makeAdmin('log-delete-devices', ['support']);
        const subject = await createSubjectUser('log-delete-devices');
        await prisma.session.create({
          data: {
            userId: subject.id,
            tokenHash: randomUUID(),
            expiresAt: new Date(Date.now() + 60 * 60 * 1000),
          },
        });
        await prisma.device.create({
          data: {
            userId: subject.id,
            expoPushToken: `ExponentPushToken[${randomUUID()}]`,
            platform: 'ios',
            lastSeenAt: new Date(),
          },
        });

        const response = await fastify().inject({
          method: 'POST',
          url: '/v1/admin/data-requests',
          headers: admin.headers,
          payload: {
            userId: subject.id,
            type: 'delete',
            channel: 'support',
            receivedAt: new Date().toISOString(),
          },
        });
        expect(response.statusCode).toBe(201);

        const sessions = await prisma.session.findMany({ where: { userId: subject.id } });
        expect(sessions).toHaveLength(0);

        const devices = await prisma.device.findMany({ where: { userId: subject.id } });
        expect(devices).toHaveLength(0);
      });

      it('sends the deletion email and disconnects chat sockets after commit', async () => {
        const admin = await makeAdmin('log-delete-side-effects', ['support']);
        const subject = await createSubjectUser('log-delete-side-effects');

        const chatSocketBridge = app.get(ChatSocketBridge);
        const originalDisconnectUser = chatSocketBridge.disconnectUser.bind(chatSocketBridge);
        const disconnectedUserIds: string[] = [];
        chatSocketBridge.disconnectUser = (userId: string) => {
          disconnectedUserIds.push(userId);
          originalDisconnectUser(userId);
        };

        let response;
        try {
          response = await fastify().inject({
            method: 'POST',
            url: '/v1/admin/data-requests',
            headers: admin.headers,
            payload: {
              userId: subject.id,
              type: 'delete',
              channel: 'support',
              receivedAt: new Date().toISOString(),
            },
          });
        } finally {
          chatSocketBridge.disconnectUser = originalDisconnectUser;
        }
        expect(response.statusCode).toBe(201);
        const body = response.json<DataRequestBody>();

        expect(disconnectedUserIds).toContain(subject.id);

        const link = await waitForLinkInEmail(
          subject.email,
          /https?:\/\/\S*account\/deletion\/cancel\/\S+#token=\S+/,
        );
        expect(link).toContain(body.id);
      });

      it('still commits the deletion and returns 201 when the post-commit side effects throw', async () => {
        const admin = await makeAdmin('log-delete-side-effect-fails', ['support']);
        const subject = await createSubjectUser('log-delete-side-effect-fails');

        const chatSocketBridge = app.get(ChatSocketBridge);
        const originalDisconnectUser = chatSocketBridge.disconnectUser.bind(chatSocketBridge);
        chatSocketBridge.disconnectUser = () => {
          throw new Error('simulated chat disconnect failure');
        };

        let response;
        try {
          response = await fastify().inject({
            method: 'POST',
            url: '/v1/admin/data-requests',
            headers: admin.headers,
            payload: {
              userId: subject.id,
              type: 'delete',
              channel: 'support',
              receivedAt: new Date().toISOString(),
            },
          });
        } finally {
          chatSocketBridge.disconnectUser = originalDisconnectUser;
        }
        expect(response.statusCode).toBe(201);
        const body = response.json<DataRequestBody>();
        expect(body.status).toBe('pending');

        const user = await prisma.user.findUniqueOrThrow({ where: { id: subject.id } });
        expect(user.status).toBe('deleted');
        expect(user.deletedAt).not.toBeNull();

        const row = await prisma.dataRequest.findUniqueOrThrow({ where: { id: body.id } });
        expect(row.status).toBe('pending');
      });

      it('keeps requestedAt near now and responseDueAt null for a heavily backdated receivedAt, and allows cancellation via the emailed token', async () => {
        const admin = await makeAdmin('log-delete-backdated', ['support']);
        const subject = await createSubjectUser('log-delete-backdated');
        const receivedAt = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000);

        const response = await fastify().inject({
          method: 'POST',
          url: '/v1/admin/data-requests',
          headers: admin.headers,
          payload: {
            userId: subject.id,
            type: 'delete',
            channel: 'support',
            receivedAt: receivedAt.toISOString(),
          },
        });
        expect(response.statusCode).toBe(201);
        const body = response.json<DataRequestBody>();
        expect(body.receivedAt).toBe(receivedAt.toISOString());
        expect(Date.now() - new Date(body.requestedAt).getTime()).toBeLessThan(10_000);
        expect(body.responseDueAt).toBeNull();

        const link = await waitForLinkInEmail(
          subject.email,
          /https?:\/\/\S*account\/deletion\/cancel\/\S+#token=\S+/,
        );
        const token = extractFragmentToken(link);
        expect(token).not.toBeNull();

        const cancelResponse = await fastify().inject({
          method: 'POST',
          url: `/v1/me/data-requests/${body.id}/cancel`,
          headers: { origin: 'http://localhost:3000' },
          payload: { token },
        });
        expect(cancelResponse.statusCode).toBe(200);
        expect(cancelResponse.json<DataRequestBody>().status).toBe('cancelled');

        const restored = await prisma.user.findUniqueOrThrow({ where: { id: subject.id } });
        expect(restored.status).toBe('active');
        expect(restored.deletedAt).toBeNull();
      });
    });
  });
});
