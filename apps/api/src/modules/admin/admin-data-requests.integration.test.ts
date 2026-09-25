import { randomUUID } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createPrismaClient, type PrismaClient } from '@photoo/db';
import { gdprResponseDueAt, type AdminPermission } from '@photoo/shared';
import { Redis } from 'ioredis';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../../testing/create-test-app.js';
import { waitForLinkInEmail } from '../../testing/mailpit.js';
import { requireIntegrationEnv } from '../../testing/require-integration-env.js';
import { generateTotpCode } from '../../testing/totp.js';
import { TEST_ENV } from '../../testing/test-env.js';

const testEnv = requireIntegrationEnv(['TEST_DATABASE_URL', 'REDIS_URL']);
const PASSWORD = `photoo-test-${randomUUID()}`;
const FAKE_IP = '10.50.22.1';

interface DataRequestBody {
  id: string;
  type: string;
  status: string;
  requestedAt: string;
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
  const createdUserIds: string[] = [];

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

  async function createSubjectUser(label: string): Promise<{ id: string; email: string }> {
    const email = uniqueEmail(`subject-${label}`);
    const user = await prisma.user.create({
      data: {
        email,
        emailVerifiedAt: new Date(),
        locale: 'en',
        countryCode: 'LU',
        roles: ['client'],
        status: 'active',
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
    await clearRateLimitKeys();
  });

  afterEach(async () => {
    await clearRateLimitKeys();
  });

  afterAll(async () => {
    if (createdUserIds.length > 0) {
      await prisma.dataRequest.deleteMany({ where: { userId: { in: createdUserIds } } });
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    await prisma.$disconnect();
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
        expect(item?.responseDueAt).toBe(gdprResponseDueAt(requestedAt).toISOString());
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
        expect(item?.responseDueAt).toBe(gdprResponseDueAt(new Date(base - 1000)).toISOString());
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
        expect(item?.responseDueAt).toBe(gdprResponseDueAt(new Date(base - 2000)).toISOString());
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
        expect(itemA?.responseDueAt).toBe(gdprResponseDueAt(new Date(base - 3000)).toISOString());
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
    });

    describe('answeredLate', () => {
      it('is true on a ready export completed after the due date, and responseDueAt stays null', async () => {
        const admin = await makeAdmin('late-ready', ['support']);
        const subject = await createSubjectUser('late-ready');
        const requestedAt = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
        const due = gdprResponseDueAt(requestedAt);
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
        const due = gdprResponseDueAt(requestedAt);
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
        const due = gdprResponseDueAt(requestedAt);
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
        const due = gdprResponseDueAt(requestedAt);
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
        const due = gdprResponseDueAt(requestedAt);
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
        const due = gdprResponseDueAt(requestedAt);
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
        const due = gdprResponseDueAt(requestedAt);
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
        const due = gdprResponseDueAt(requestedAt);
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
        const due = gdprResponseDueAt(requestedAt);
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
          const due = gdprResponseDueAt(requestedAt);
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
    });

    describe('answeredLate for a failed export later answered by a newer export', () => {
      it('is true when the retry completes after the failed request’s due date', async () => {
        const admin = await makeAdmin('late-retry-late', ['support']);
        const subject = await createSubjectUser('late-retry-late');
        const requestedAt = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
        const due = gdprResponseDueAt(requestedAt);
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
        const due = gdprResponseDueAt(requestedAt);
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
        const due = gdprResponseDueAt(requestedAt);
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
        const due = gdprResponseDueAt(requestedAt);
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
        const due = gdprResponseDueAt(requestedAt);
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
        const due = gdprResponseDueAt(requestedAt);
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
        const due = gdprResponseDueAt(requestedAt);
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
    });
  });

  describe('POST /v1/admin/data-requests/:id/retry-export', () => {
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
      expect(auditRow?.ip).toBe(FAKE_IP);
    });
  });
});
