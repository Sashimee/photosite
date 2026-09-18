import { randomUUID } from 'node:crypto';
import { createPrismaClient, type PrismaClient } from '@photoo/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditLogService } from '../../common/audit-log.service.js';
import { StorageService } from '../../storage/storage.service.js';
import { requireIntegrationEnv } from '../../testing/require-integration-env.js';
import { TEST_ENV } from '../../testing/test-env.js';
import { expireExports } from './expire-exports.js';

const testEnv = requireIntegrationEnv(['TEST_DATABASE_URL']);

function fakeLogger() {
  return { log: () => undefined, warn: () => undefined, error: () => undefined };
}

describe('expireExports against a real database and MinIO', () => {
  if (!testEnv) {
    it.skip('skipped: TEST_DATABASE_URL is not set', () => undefined);
    return;
  }

  let prisma: PrismaClient;
  let auditLog: AuditLogService;
  const storage = new StorageService(TEST_ENV);
  const runId = randomUUID().replaceAll('-', '').slice(0, 8);

  let userId: string;
  let expiredRequestId: string;
  let liveRequestId: string;
  let expiredObjectKey: string;
  let liveObjectKey: string;

  beforeAll(async () => {
    prisma = createPrismaClient(testEnv.TEST_DATABASE_URL);
    auditLog = new AuditLogService({ client: prisma } as never);

    const user = await prisma.user.create({
      data: {
        email: `gdpr-expire-export-${runId}@photoo.test`,
        name: 'Fx Expire Export',
        locale: 'en',
        countryCode: 'LU',
        roles: ['client'],
        status: 'active',
      },
    });
    userId = user.id;

    expiredObjectKey = `gdpr-exports-test/${runId}/expired.zip`;
    await storage.putObject({
      bucket: storage.config.privateBucket,
      key: expiredObjectKey,
      body: Buffer.from('expired-zip-bytes'),
      contentType: 'application/zip',
    });
    const expiredRequest = await prisma.dataRequest.create({
      data: {
        userId,
        type: 'export',
        status: 'ready',
        completedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
        exportKey: expiredObjectKey,
        expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
      },
    });
    expiredRequestId = expiredRequest.id;

    liveObjectKey = `gdpr-exports-test/${runId}/live.zip`;
    await storage.putObject({
      bucket: storage.config.privateBucket,
      key: liveObjectKey,
      body: Buffer.from('live-zip-bytes'),
      contentType: 'application/zip',
    });
    const liveRequest = await prisma.dataRequest.create({
      data: {
        userId,
        type: 'export',
        status: 'ready',
        completedAt: new Date(),
        exportKey: liveObjectKey,
        expiresAt: new Date(Date.now() + 6 * 24 * 60 * 60 * 1000),
      },
    });
    liveRequestId = liveRequest.id;
  });

  afterAll(async () => {
    await storage.deleteObject(storage.config.privateBucket, liveObjectKey).catch(() => undefined);
    await prisma.auditLog.deleteMany({
      where: { targetType: 'DataRequest', action: 'gdpr_sweep.exports_expired' },
    });
    await prisma.dataRequest.deleteMany({
      where: { id: { in: [expiredRequestId, liveRequestId] } },
    });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it('deletes the object and clears the key only for the expired export', async () => {
    const result = await expireExports({
      prisma: { client: prisma },
      storage,
      auditLog,
      logger: fakeLogger() as never,
    });

    expect(result.exportsExpired).toBeGreaterThanOrEqual(1);

    const expiredRow = await prisma.dataRequest.findUniqueOrThrow({
      where: { id: expiredRequestId },
    });
    expect(expiredRow.exportKey).toBeNull();
    expect(expiredRow.status).toBe('ready');
    await expect(
      storage.getObjectBuffer(storage.config.privateBucket, expiredObjectKey),
    ).rejects.toThrow();

    const liveRow = await prisma.dataRequest.findUniqueOrThrow({ where: { id: liveRequestId } });
    expect(liveRow.exportKey).toBe(liveObjectKey);
    const liveBuffer = await storage.getObjectBuffer(storage.config.privateBucket, liveObjectKey);
    expect(liveBuffer.toString('utf8')).toBe('live-zip-bytes');
  });
});
