import { randomUUID } from 'node:crypto';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createPrismaClient, type PrismaClient } from '@photoo/db';
import { createS3Client } from '@photoo/shared/storage';
import { Redis } from 'ioredis';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../../testing/create-test-app.js';
import { waitForLinkInEmail } from '../../testing/mailpit.js';
import { requireIntegrationEnv } from '../../testing/require-integration-env.js';
import { TEST_ENV } from '../../testing/test-env.js';
import { s3ConfigFromEnv } from '../../storage/s3-config.js';

const testEnv = requireIntegrationEnv(['TEST_DATABASE_URL', 'REDIS_URL']);
const PASSWORD = `photoo-test-${randomUUID()}`;

// auth.integration.test.ts signs in as the shared seed users too (to test
// its own account-scoped rate limit), and account-scoped keys aren't tied to
// an IP; a fresh unique account per run avoids racing that suite's counter
// for the same seed account instead of just moving the contention (issue #97).
const AUTH_FAKE_IP = '10.50.3.1';

function extractFragmentToken(link: string): string | null {
  const hashIndex = link.indexOf('#token=');
  if (hashIndex === -1) {
    return null;
  }
  return decodeURIComponent(link.slice(hashIndex + '#token='.length));
}

function uniqueEmail(label: string): string {
  return `uploads-${label}-${randomUUID()}@photoo.test`;
}

async function clearRateLimitKeys(redis: Redis): Promise<void> {
  const patterns = [
    'rate-limit:uploads:*',
    'lockout:uploads:*',
    `rate-limit:auth:*:${AUTH_FAKE_IP}`,
    `lockout:auth:*:${AUTH_FAKE_IP}`,
  ];
  const all = (await Promise.all(patterns.map((pattern) => redis.keys(pattern)))).flat();
  if (all.length > 0) {
    await redis.del(...all);
  }
}

interface CreateUploadBody {
  uploadId: string;
  url: string;
  headers: Record<string, string>;
  expiresAt: string;
}

interface UploadBody {
  id: string;
  status: string;
  virusScanStatus: string;
  actualSizeBytes: number | null;
  declaredSizeBytes: number;
}

describe('uploads integration', () => {
  if (!testEnv) {
    it.skip('skipped: TEST_DATABASE_URL or REDIS_URL is not set', () => undefined);
    return;
  }

  let app: NestFastifyApplication;
  let prisma: PrismaClient;
  let redis: Redis;
  let clientToken: string;
  let clientId: string;
  let photographerToken: string;
  const createdUploadIds: string[] = [];
  const createdUserIds: string[] = [];

  function fastify() {
    return app.getHttpAdapter().getInstance();
  }

  async function signUpAndSignIn(
    roles: readonly string[],
  ): Promise<{ token: string; id: string }> {
    const email = uniqueEmail(roles.join('-'));
    const signUpResponse = await fastify().inject({
      method: 'POST',
      url: '/v1/auth/sign-up',
      remoteAddress: AUTH_FAKE_IP,
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
      remoteAddress: AUTH_FAKE_IP,
      payload: { token },
    });

    const signInResponse = await fastify().inject({
      method: 'POST',
      url: '/v1/auth/sign-in',
      remoteAddress: AUTH_FAKE_IP,
      payload: { email, password: PASSWORD },
    });
    const body = signInResponse.json<{ user: { id: string }; session: { token: string } }>();
    return { token: body.session.token, id: body.user.id };
  }

  function authHeaders(token: string) {
    return { authorization: `Bearer ${token}` };
  }

  async function createUpload(overrides: Record<string, unknown> = {}) {
    const response = await fastify().inject({
      method: 'POST',
      url: '/v1/uploads',
      headers: authHeaders(clientToken),
      payload: { purpose: 'portfolio', mimeType: 'image/jpeg', sizeBytes: 1024, ...overrides },
    });
    if (response.statusCode === 201) {
      createdUploadIds.push(response.json<CreateUploadBody>().uploadId);
    }
    return response;
  }

  beforeAll(async () => {
    app = await createTestApp({
      ...TEST_ENV,
      DATABASE_URL: testEnv.TEST_DATABASE_URL,
      REDIS_URL: testEnv.REDIS_URL,
    });
    prisma = createPrismaClient(testEnv.TEST_DATABASE_URL);
    redis = new Redis(testEnv.REDIS_URL);
    await clearRateLimitKeys(redis);

    const client = await signUpAndSignIn(['client']);
    clientToken = client.token;
    clientId = client.id;
    photographerToken = (await signUpAndSignIn(['photographer'])).token;
  });

  afterEach(async () => {
    await clearRateLimitKeys(redis);
  });

  afterAll(async () => {
    await prisma.upload.deleteMany({ where: { id: { in: createdUploadIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await prisma.$disconnect();
    redis.disconnect();
    await app.close();
  });

  it('issues a presigned PUT with exactly Content-Type and Content-Length, uploads and completes it', async () => {
    const buffer = Buffer.alloc(1024, 7);
    const createResponse = await createUpload({ sizeBytes: buffer.length });
    expect(createResponse.statusCode).toBe(201);
    const created = createResponse.json<CreateUploadBody>();
    expect(Object.keys(created.headers).sort()).toEqual(['Content-Length', 'Content-Type']);
    expect(created.headers['Content-Type']).toBe('image/jpeg');
    expect(created.headers['Content-Length']).toBe(String(buffer.length));

    const putResponse = await fetch(created.url, {
      method: 'PUT',
      body: buffer,
      headers: created.headers,
    });
    expect(putResponse.status).toBe(200);

    const row = await prisma.upload.findUniqueOrThrow({ where: { id: created.uploadId } });
    expect(row.objectKey).toBe(`u/${clientId}/${created.uploadId}`);

    const completeResponse = await fastify().inject({
      method: 'POST',
      url: `/v1/uploads/${created.uploadId}/complete`,
      headers: authHeaders(clientToken),
    });
    expect(completeResponse.statusCode).toBe(200);
    const completed = completeResponse.json<UploadBody>();
    expect(completed.status).toBe('uploaded');
    expect(completed.virusScanStatus).toBe('pending');
    expect(completed.actualSizeBytes).toBe(buffer.length);

    const completeAgain = await fastify().inject({
      method: 'POST',
      url: `/v1/uploads/${created.uploadId}/complete`,
      headers: authHeaders(clientToken),
    });
    expect(completeAgain.statusCode).toBe(200);
    expect(completeAgain.json()).toEqual(completed);

    const statusResponse = await fastify().inject({
      method: 'GET',
      url: `/v1/uploads/${created.uploadId}`,
      headers: authHeaders(clientToken),
    });
    expect(statusResponse.statusCode).toBe(200);
    expect(statusResponse.json<UploadBody>().status).toBe('uploaded');

    const downloadResponse = await fastify().inject({
      method: 'GET',
      url: `/v1/uploads/${created.uploadId}/download`,
      headers: authHeaders(clientToken),
    });
    expect(downloadResponse.statusCode).toBe(409);
  });

  it('prevents a re-PUT to the original presigned URL from swapping the completed object', async () => {
    const original = Buffer.alloc(1024, 7);
    const swapped = Buffer.alloc(1024, 9);
    const createResponse = await createUpload({ sizeBytes: original.length });
    const created = createResponse.json<CreateUploadBody>();

    await fetch(created.url, { method: 'PUT', body: original, headers: created.headers });

    const completeResponse = await fastify().inject({
      method: 'POST',
      url: `/v1/uploads/${created.uploadId}/complete`,
      headers: authHeaders(clientToken),
    });
    expect(completeResponse.statusCode).toBe(200);

    const row = await prisma.upload.findUniqueOrThrow({ where: { id: created.uploadId } });
    expect(row.objectKey).toBe(`o/${clientId}/${created.uploadId}`);

    const rePutResponse = await fetch(created.url, {
      method: 'PUT',
      body: swapped,
      headers: created.headers,
    });
    expect(rePutResponse.status).toBe(200);

    const rowAfterRePut = await prisma.upload.findUniqueOrThrow({
      where: { id: created.uploadId },
    });
    expect(rowAfterRePut.objectKey).toBe(row.objectKey);

    await prisma.upload.update({
      where: { id: created.uploadId },
      data: { status: 'clean', virusScanStatus: 'clean' },
    });

    const downloadResponse = await fastify().inject({
      method: 'GET',
      url: `/v1/uploads/${created.uploadId}/download`,
      headers: authHeaders(clientToken),
    });
    expect(downloadResponse.statusCode).toBe(200);

    const downloadUrl = downloadResponse.json<{ url: string }>().url;
    const served = await fetch(downloadUrl);
    const servedBuffer = Buffer.from(await served.arrayBuffer());
    expect(servedBuffer.equals(original)).toBe(true);
    expect(servedBuffer.equals(swapped)).toBe(false);
    expect(served.headers.get('content-type')).toBe('image/jpeg');
    expect(served.headers.get('content-disposition')).toContain('attachment');
  });

  it('omits the attachment disposition once an upload is processed', async () => {
    const buffer = Buffer.alloc(256, 3);
    const createResponse = await createUpload({ sizeBytes: buffer.length });
    const created = createResponse.json<CreateUploadBody>();
    await fetch(created.url, { method: 'PUT', body: buffer, headers: created.headers });
    await fastify().inject({
      method: 'POST',
      url: `/v1/uploads/${created.uploadId}/complete`,
      headers: authHeaders(clientToken),
    });
    await prisma.upload.update({
      where: { id: created.uploadId },
      data: { status: 'processed', virusScanStatus: 'clean' },
    });

    const downloadResponse = await fastify().inject({
      method: 'GET',
      url: `/v1/uploads/${created.uploadId}/download`,
      headers: authHeaders(clientToken),
    });
    expect(downloadResponse.statusCode).toBe(200);

    const downloadUrl = downloadResponse.json<{ url: string }>().url;
    const served = await fetch(downloadUrl);
    expect(served.headers.get('content-disposition')).toBeNull();
  });

  it('rejects completing when the object content-type does not match the declared mime type', async () => {
    const buffer = Buffer.alloc(512, 1);
    const createResponse = await createUpload({ sizeBytes: buffer.length });
    const created = createResponse.json<CreateUploadBody>();

    const putResponse = await fetch(created.url, {
      method: 'PUT',
      body: buffer,
      headers: { ...created.headers, 'Content-Type': 'application/pdf' },
    });
    expect(putResponse.status).toBe(200);

    const completeResponse = await fastify().inject({
      method: 'POST',
      url: `/v1/uploads/${created.uploadId}/complete`,
      headers: authHeaders(clientToken),
    });
    expect(completeResponse.statusCode).toBe(409);

    const row = await prisma.upload.findUniqueOrThrow({ where: { id: created.uploadId } });
    expect(row.status).toBe('failed');
  });

  it('rejects completing when the stored object size does not match the declared size', async () => {
    const createResponse = await createUpload({ sizeBytes: 2048 });
    const created = createResponse.json<CreateUploadBody>();
    const row = await prisma.upload.findUniqueOrThrow({ where: { id: created.uploadId } });

    const s3 = createS3Client(s3ConfigFromEnv(TEST_ENV));
    await s3.send(
      new PutObjectCommand({
        Bucket: 'photoo-private',
        Key: row.objectKey,
        Body: Buffer.alloc(999, 2),
        ContentType: 'image/jpeg',
      }),
    );

    const completeResponse = await fastify().inject({
      method: 'POST',
      url: `/v1/uploads/${created.uploadId}/complete`,
      headers: authHeaders(clientToken),
    });
    expect(completeResponse.statusCode).toBe(409);

    const updated = await prisma.upload.findUniqueOrThrow({ where: { id: created.uploadId } });
    expect(updated.status).toBe('failed');
  });

  it('rejects completing before anything was ever uploaded', async () => {
    const createResponse = await createUpload();
    const created = createResponse.json<CreateUploadBody>();

    const completeResponse = await fastify().inject({
      method: 'POST',
      url: `/v1/uploads/${created.uploadId}/complete`,
      headers: authHeaders(clientToken),
    });
    expect(completeResponse.statusCode).toBe(409);
  });

  it('returns 404 for status, complete and download to a non-owner', async () => {
    const createResponse = await createUpload();
    const created = createResponse.json<CreateUploadBody>();

    const statusResponse = await fastify().inject({
      method: 'GET',
      url: `/v1/uploads/${created.uploadId}`,
      headers: authHeaders(photographerToken),
    });
    expect(statusResponse.statusCode).toBe(404);

    const completeResponse = await fastify().inject({
      method: 'POST',
      url: `/v1/uploads/${created.uploadId}/complete`,
      headers: authHeaders(photographerToken),
    });
    expect(completeResponse.statusCode).toBe(404);

    const downloadResponse = await fastify().inject({
      method: 'GET',
      url: `/v1/uploads/${created.uploadId}/download`,
      headers: authHeaders(photographerToken),
    });
    expect(downloadResponse.statusCode).toBe(404);
  });

  it('returns 404 for an unknown upload id', async () => {
    const response = await fastify().inject({
      method: 'GET',
      url: '/v1/uploads/00000000-0000-7000-8000-000000000000',
      headers: authHeaders(clientToken),
    });
    expect(response.statusCode).toBe(404);
  });

  it('rejects download of a failed upload with the same error as a not-yet-ready upload', async () => {
    const createResponse = await createUpload();
    const created = createResponse.json<CreateUploadBody>();
    await prisma.upload.update({
      where: { id: created.uploadId },
      data: { status: 'failed', virusScanStatus: 'failed' },
    });

    const notReadyResponse = await fastify().inject({
      method: 'GET',
      url: `/v1/uploads/${created.uploadId}/download`,
      headers: authHeaders(clientToken),
    });
    expect(notReadyResponse.statusCode).toBe(409);

    const pendingCreate = await createUpload();
    const pending = pendingCreate.json<CreateUploadBody>();
    const pendingResponse = await fastify().inject({
      method: 'GET',
      url: `/v1/uploads/${pending.uploadId}/download`,
      headers: authHeaders(clientToken),
    });
    expect(pendingResponse.statusCode).toBe(409);
    const notReadyBody = notReadyResponse.json<{ code: string; message: string }>();
    const pendingBody = pendingResponse.json<{ code: string; message: string }>();
    expect(notReadyBody.code).toBe(pendingBody.code);
    expect(notReadyBody.message).toBe(pendingBody.message);
  });

  it('returns a validation error for a malformed upload id', async () => {
    const responses = await Promise.all([
      fastify().inject({
        method: 'GET',
        url: '/v1/uploads/not-a-uuid',
        headers: authHeaders(clientToken),
      }),
      fastify().inject({
        method: 'POST',
        url: '/v1/uploads/not-a-uuid/complete',
        headers: authHeaders(clientToken),
      }),
      fastify().inject({
        method: 'GET',
        url: '/v1/uploads/not-a-uuid/download',
        headers: authHeaders(clientToken),
      }),
    ]);
    for (const response of responses) {
      expect(response.statusCode).toBe(400);
      expect(response.json<{ code: string }>().code).toBe('VALIDATION_ERROR');
    }
  });

  it('requires a session for every route', async () => {
    const responses = await Promise.all([
      fastify().inject({
        method: 'POST',
        url: '/v1/uploads',
        payload: { purpose: 'portfolio', mimeType: 'image/jpeg', sizeBytes: 1024 },
      }),
      fastify().inject({ method: 'GET', url: '/v1/uploads/00000000-0000-7000-8000-000000000000' }),
    ]);
    for (const response of responses) {
      expect(response.statusCode).toBe(401);
    }
  });

  it('rejects an unsupported mime type and an oversized declared size', async () => {
    const badMime = await fastify().inject({
      method: 'POST',
      url: '/v1/uploads',
      headers: authHeaders(clientToken),
      payload: { purpose: 'avatar', mimeType: 'application/pdf', sizeBytes: 1024 },
    });
    expect(badMime.statusCode).toBe(400);

    const tooBig = await fastify().inject({
      method: 'POST',
      url: '/v1/uploads',
      headers: authHeaders(clientToken),
      payload: { purpose: 'avatar', mimeType: 'image/jpeg', sizeBytes: 999_999_999 },
    });
    expect(tooBig.statusCode).toBe(400);
  });

  it('rate limits repeated upload creation for the same account', async () => {
    let limited = false;
    for (let i = 0; i < 65 && !limited; i += 1) {
      const response = await createUpload({ sizeBytes: 1 + i });
      if (response.statusCode === 429) {
        limited = true;
      }
    }
    expect(limited).toBe(true);
  }, 30_000);
});
