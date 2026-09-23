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
const FAKE_IP = '10.50.20.1';

function extractFragmentToken(link: string): string | null {
  const hashIndex = link.indexOf('#token=');
  if (hashIndex === -1) {
    return null;
  }
  return decodeURIComponent(link.slice(hashIndex + '#token='.length));
}

function uniqueEmail(label: string): string {
  return `professionals-${label}-${randomUUID()}@photoo.test`;
}

interface ProfileBody {
  id: string;
  companyName: string;
  website: string | null;
  logoUrl: string | null;
  verified: boolean;
  vatNumber: string | null;
}

describe('professionals integration', () => {
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

  async function clearRateLimitKeys(): Promise<void> {
    const patterns = [`rate-limit:auth:*:${FAKE_IP}`, `lockout:auth:*:${FAKE_IP}`];
    const keys = (await Promise.all(patterns.map((pattern) => redis.keys(pattern)))).flat();
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  }

  async function signUpAndSignIn(roles: readonly string[]): Promise<{ token: string; id: string }> {
    const email = uniqueEmail(roles.join('-'));
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
    return { token: body.session.token, id: body.user.id };
  }

  function authHeaders(token: string) {
    return { authorization: `Bearer ${token}` };
  }

  async function createUpload(token: string, purpose: string) {
    const response = await fastify().inject({
      method: 'POST',
      url: '/v1/uploads',
      remoteAddress: FAKE_IP,
      headers: authHeaders(token),
      payload: { purpose, mimeType: 'image/jpeg', sizeBytes: 1024 },
    });
    return response.json<{ uploadId: string }>().uploadId;
  }

  async function markScanClean(uploadId: string): Promise<void> {
    await prisma.upload.update({
      where: { id: uploadId },
      data: { status: 'clean', virusScanStatus: 'clean' },
    });
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
      await prisma.jobOffer.deleteMany({
        where: { professional: { userId: { in: createdUserIds } } },
      });
      await prisma.professionalProfile.deleteMany({ where: { userId: { in: createdUserIds } } });
      await prisma.upload.deleteMany({ where: { ownerId: { in: createdUserIds } } });
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    await prisma.$disconnect();
    redis.disconnect();
    await app.close();
  });

  describe('POST /v1/me/professional-profile', () => {
    it('rejects an unauthenticated request with 401', async () => {
      const response = await fastify().inject({
        method: 'POST',
        url: '/v1/me/professional-profile',
        payload: { companyName: 'Fixture Co' },
      });
      expect(response.statusCode).toBe(401);
    });

    it('creates the profile and adds the professional role in the same account, with an audit log row', async () => {
      const client = await signUpAndSignIn(['client']);

      const response = await fastify().inject({
        method: 'POST',
        url: '/v1/me/professional-profile',
        headers: authHeaders(client.token),
        payload: {
          companyName: 'Fixture Co',
          website: 'https://example.com',
          vatNumber: 'LU12345678',
        },
      });
      expect(response.statusCode).toBe(201);
      const body = response.json<ProfileBody>();
      expect(body.companyName).toBe('Fixture Co');
      expect(body.vatNumber).toBe('LU12345678');

      const user = await prisma.user.findUniqueOrThrow({ where: { id: client.id } });
      expect(user.roles).toContain('professional');
      expect(user.roles).toContain('client');

      const auditLogs = await prisma.auditLog.findMany({
        where: { actorId: client.id, action: 'user.role_added', targetId: client.id },
      });
      expect(auditLogs).toHaveLength(1);
    });

    it('does not duplicate the role or audit log row when the caller already has it', async () => {
      const professional = await signUpAndSignIn(['professional']);

      const response = await fastify().inject({
        method: 'POST',
        url: '/v1/me/professional-profile',
        headers: authHeaders(professional.token),
        payload: { companyName: 'Already Professional Co' },
      });
      expect(response.statusCode).toBe(201);

      const auditLogs = await prisma.auditLog.findMany({
        where: { actorId: professional.id, action: 'user.role_added', targetId: professional.id },
      });
      expect(auditLogs).toHaveLength(0);
    });

    it('rejects a second profile for the same account with 409', async () => {
      const client = await signUpAndSignIn(['client']);
      await fastify().inject({
        method: 'POST',
        url: '/v1/me/professional-profile',
        headers: authHeaders(client.token),
        payload: { companyName: 'First Co' },
      });

      const second = await fastify().inject({
        method: 'POST',
        url: '/v1/me/professional-profile',
        headers: authHeaders(client.token),
        payload: { companyName: 'Second Co' },
      });
      expect(second.statusCode).toBe(409);
    });

    it('rejects a logoUploadId not owned by the caller with 404', async () => {
      const client = await signUpAndSignIn(['client']);
      const otherUser = await signUpAndSignIn(['client']);
      const otherUploadId = await createUpload(otherUser.token, 'logo');

      const response = await fastify().inject({
        method: 'POST',
        url: '/v1/me/professional-profile',
        headers: authHeaders(client.token),
        payload: { companyName: 'Wrong Owner Co', logoUploadId: otherUploadId },
      });
      expect(response.statusCode).toBe(404);
    });

    it('rejects a logoUploadId whose purpose is not "logo" with 422', async () => {
      const client = await signUpAndSignIn(['client']);
      const avatarUploadId = await createUpload(client.token, 'avatar');

      const response = await fastify().inject({
        method: 'POST',
        url: '/v1/me/professional-profile',
        headers: authHeaders(client.token),
        payload: { companyName: 'Wrong Purpose Co', logoUploadId: avatarUploadId },
      });
      expect(response.statusCode).toBe(422);
    });
  });

  describe('GET /v1/me/professional-profile', () => {
    it('rejects a caller without the professional role with 403', async () => {
      const client = await signUpAndSignIn(['client']);
      const response = await fastify().inject({
        method: 'GET',
        url: '/v1/me/professional-profile',
        headers: authHeaders(client.token),
      });
      expect(response.statusCode).toBe(403);
    });

    it('returns 404 for a professional without a profile', async () => {
      const professional = await signUpAndSignIn(['professional']);
      const response = await fastify().inject({
        method: 'GET',
        url: '/v1/me/professional-profile',
        headers: authHeaders(professional.token),
      });
      expect(response.statusCode).toBe(404);
    });

    it('returns the own profile including vatNumber', async () => {
      const client = await signUpAndSignIn(['client']);
      await fastify().inject({
        method: 'POST',
        url: '/v1/me/professional-profile',
        headers: authHeaders(client.token),
        payload: { companyName: 'Own View Co', vatNumber: 'LU99999999' },
      });

      const response = await fastify().inject({
        method: 'GET',
        url: '/v1/me/professional-profile',
        headers: authHeaders(client.token),
      });
      expect(response.statusCode).toBe(200);
      expect(response.json<ProfileBody>().vatNumber).toBe('LU99999999');
    });
  });

  describe('PATCH /v1/me/professional-profile', () => {
    it('updates companyName, website and vatNumber', async () => {
      const client = await signUpAndSignIn(['client']);
      await fastify().inject({
        method: 'POST',
        url: '/v1/me/professional-profile',
        headers: authHeaders(client.token),
        payload: { companyName: 'Before Co' },
      });

      const response = await fastify().inject({
        method: 'PATCH',
        url: '/v1/me/professional-profile',
        headers: authHeaders(client.token),
        payload: {
          companyName: 'After Co',
          website: 'https://after.example.com',
          vatNumber: 'LU11223344',
        },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json<ProfileBody>();
      expect(body.companyName).toBe('After Co');
      expect(body.website).toBe('https://after.example.com');
      expect(body.vatNumber).toBe('LU11223344');
    });

    it('accepts attaching a clean logo upload', async () => {
      const client = await signUpAndSignIn(['client']);
      await fastify().inject({
        method: 'POST',
        url: '/v1/me/professional-profile',
        headers: authHeaders(client.token),
        payload: { companyName: 'Logo Co' },
      });
      const logoUploadId = await createUpload(client.token, 'logo');
      await markScanClean(logoUploadId);

      const response = await fastify().inject({
        method: 'PATCH',
        url: '/v1/me/professional-profile',
        headers: authHeaders(client.token),
        payload: { logoUploadId },
      });
      expect(response.statusCode).toBe(200);
    });

    it('rejects a caller without a profile with 404', async () => {
      const professional = await signUpAndSignIn(['professional']);
      const response = await fastify().inject({
        method: 'PATCH',
        url: '/v1/me/professional-profile',
        headers: authHeaders(professional.token),
        payload: { companyName: 'Nope Co' },
      });
      expect(response.statusCode).toBe(404);
    });
  });
});
