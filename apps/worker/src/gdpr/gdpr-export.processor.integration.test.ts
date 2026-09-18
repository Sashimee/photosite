import { randomUUID } from 'node:crypto';
import { createPrismaClient, type PrismaClient } from '@photoo/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditLogService } from '../common/audit-log.service.js';
import { StorageService } from '../storage/storage.service.js';
import { readZipEntries, type ZipEntry } from '../testing/read-zip.js';
import { requireIntegrationEnv } from '../testing/require-integration-env.js';
import { TEST_ENV } from '../testing/test-env.js';
import { createGdprExportProcessor } from './gdpr-export.processor.js';

const testEnv = requireIntegrationEnv(['TEST_DATABASE_URL']);

function fakeLogger() {
  return { log: () => undefined, warn: () => undefined, error: () => undefined };
}

function fakeJob(dataRequestId: string) {
  return {
    data: { dataRequestId },
    attemptsMade: 1,
    opts: { attempts: 3 },
  } as never;
}

function textOf(entries: ZipEntry[], name: string): string {
  const entry = entries.find((candidate) => candidate.name === name);
  if (!entry) {
    throw new Error(`zip is missing ${name}`);
  }
  return entry.content.toString('utf8');
}

function jsonOf(entries: ZipEntry[], name: string): unknown {
  return JSON.parse(textOf(entries, name));
}

describe('createGdprExportProcessor against a real database and MinIO', () => {
  if (!testEnv) {
    it.skip('skipped: TEST_DATABASE_URL is not set', () => undefined);
    return;
  }

  let prisma: PrismaClient;
  let auditLog: AuditLogService;
  const storage = new StorageService(TEST_ENV);
  const runId = randomUUID().replaceAll('-', '').slice(0, 8);

  let subjectId: string;
  let counterpartId: string;
  const counterpartEmail = `secret-counterpart-${runId}@photoo.test`;
  const verificationSecret = `SECRET-ID-DOCUMENT-BYTES-${runId}`;
  let profileId: string;
  let dataRequestId: string;
  let portfolioObjectKey: string;
  let verificationObjectKey: string;
  const createdObjectKeys: string[] = [];

  beforeAll(async () => {
    prisma = createPrismaClient(testEnv.TEST_DATABASE_URL);
    auditLog = new AuditLogService({ client: prisma } as never);

    const subject = await prisma.user.create({
      data: {
        email: `gdpr-export-subject-${runId}@photoo.test`,
        emailVerifiedAt: new Date(),
        name: 'Fx Export Subject',
        locale: 'en',
        countryCode: 'LU',
        roles: ['photographer'],
        status: 'active',
      },
    });
    subjectId = subject.id;

    const counterpart = await prisma.user.create({
      data: {
        email: counterpartEmail,
        emailVerifiedAt: new Date(),
        name: 'Fx Export Counterpart',
        locale: 'en',
        countryCode: 'LU',
        roles: ['client'],
        status: 'active',
      },
    });
    counterpartId = counterpart.id;

    portfolioObjectKey = `worker-gdpr-export-test/${runId}/portfolio.jpg`;
    createdObjectKeys.push(portfolioObjectKey);
    await storage.putObject({
      bucket: storage.config.privateBucket,
      key: portfolioObjectKey,
      body: Buffer.from(`portfolio-bytes-${runId}`),
      contentType: 'image/jpeg',
    });
    const portfolioUpload = await prisma.upload.create({
      data: {
        ownerId: subjectId,
        purpose: 'portfolio',
        status: 'processed',
        mimeType: 'image/jpeg',
        declaredSizeBytes: 100,
        actualSizeBytes: 100,
        objectKey: portfolioObjectKey,
        virusScanStatus: 'clean',
      },
    });

    verificationObjectKey = `worker-gdpr-export-test/${runId}/verification.pdf`;
    createdObjectKeys.push(verificationObjectKey);
    await storage.putObject({
      bucket: storage.config.privateBucket,
      key: verificationObjectKey,
      body: Buffer.from(verificationSecret),
      contentType: 'application/pdf',
    });
    const verificationUpload = await prisma.upload.create({
      data: {
        ownerId: subjectId,
        purpose: 'verification_document',
        status: 'processed',
        mimeType: 'application/pdf',
        declaredSizeBytes: verificationSecret.length,
        actualSizeBytes: verificationSecret.length,
        objectKey: verificationObjectKey,
        virusScanStatus: 'clean',
      },
    });

    const avatarObjectKey = `worker-gdpr-export-test/${runId}/avatar.webp`;
    createdObjectKeys.push(avatarObjectKey);
    await storage.putObject({
      bucket: storage.config.privateBucket,
      key: avatarObjectKey,
      body: Buffer.from(`avatar-bytes-${runId}`),
      contentType: 'image/webp',
    });
    const avatarUpload = await prisma.upload.create({
      data: {
        ownerId: subjectId,
        purpose: 'avatar',
        status: 'processed',
        mimeType: 'image/webp',
        declaredSizeBytes: 50,
        actualSizeBytes: 50,
        objectKey: avatarObjectKey,
        virusScanStatus: 'clean',
      },
    });

    const coverObjectKey = `worker-gdpr-export-test/${runId}/cover.png`;
    createdObjectKeys.push(coverObjectKey);
    await storage.putObject({
      bucket: storage.config.privateBucket,
      key: coverObjectKey,
      body: Buffer.from(`cover-bytes-${runId}`),
      contentType: 'image/png',
    });
    const coverUpload = await prisma.upload.create({
      data: {
        ownerId: subjectId,
        purpose: 'cover',
        status: 'processed',
        mimeType: 'image/png',
        declaredSizeBytes: 50,
        actualSizeBytes: 50,
        objectKey: coverObjectKey,
        virusScanStatus: 'clean',
      },
    });

    const profile = await prisma.photographerProfile.create({
      data: {
        userId: subjectId,
        slug: `fx-gdpr-export-${runId}`,
        displayName: 'Fx Export Photographer',
        bio: {},
        links: {},
        categories: ['wedding'],
        languages: ['en'],
        city: 'Luxembourg',
        countryCode: 'LU',
        avatarUploadId: avatarUpload.id,
        coverUploadId: coverUpload.id,
      },
    });
    profileId = profile.id;

    await prisma.portfolioImage.create({
      data: { profileId: profile.id, uploadId: portfolioUpload.id, order: 0, status: 'approved' },
    });

    const verificationCase = await prisma.verificationCase.create({
      data: { userId: subjectId, countryCode: 'LU', status: 'submitted', submittedAt: new Date() },
    });
    await prisma.verificationDocument.create({
      data: {
        caseId: verificationCase.id,
        documentKey: 'id_front',
        uploadId: verificationUpload.id,
      },
    });

    await prisma.consentRecord.create({
      data: { userId: subjectId, purpose: 'analytics', granted: true, policyVersion: '1' },
    });
    await prisma.session.create({
      data: {
        userId: subjectId,
        tokenHash: `hash-${runId}-export`,
        expiresAt: new Date(Date.now() + 60_000),
        twoFactorVerifiedAt: new Date(),
      },
    });
    await prisma.notification.create({
      data: {
        userId: subjectId,
        type: 'quote_expired',
        payload: { quoteId: 'x' },
        channels: ['in_app'],
      },
    });

    const request = await prisma.request.create({
      data: {
        clientId: counterpartId,
        title: `Fx Export Request ${runId}`,
        category: 'wedding',
        description: 'A fixture request for the gdpr-export test.',
        eventDate: new Date(),
        dateFlexible: false,
        address: { line1: '1 Fixture Way', city: 'Luxembourg', postalCode: 'L-1000' },
        city: 'Luxembourg',
        countryCode: 'LU',
        budgetMinCents: 100000,
        budgetMaxCents: 200000,
        currency: 'EUR',
        usage: 'personal',
        status: 'quoted',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    const quote = await prisma.quote.create({
      data: {
        requestId: request.id,
        photographerId: profile.id,
        clientId: counterpartId,
        lineItems: [{ label: 'Coverage', qty: 1, unitCents: 50000 }],
        subtotalCents: 50000,
        platformFeeCents: 2500,
        totalCents: 50000,
        feePercent: 5,
        licenceUsage: 'personal',
        currency: 'EUR',
        validUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        status: 'sent',
      },
    });

    const conversation = await prisma.conversation.create({
      data: { type: 'quote', subjectId: quote.id },
    });
    await prisma.conversationParticipant.create({
      data: { conversationId: conversation.id, userId: subjectId },
    });
    await prisma.conversationParticipant.create({
      data: { conversationId: conversation.id, userId: counterpartId },
    });
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        senderId: counterpartId,
        body: 'Looking forward to it, see you then!',
      },
    });
    await prisma.message.create({
      data: { conversationId: conversation.id, senderId: subjectId, body: 'Sounds great.' },
    });

    const dataRequest = await prisma.dataRequest.create({
      data: { userId: subjectId, type: 'export', status: 'pending' },
    });
    dataRequestId = dataRequest.id;
  });

  afterAll(async () => {
    await Promise.all(
      createdObjectKeys.map((key) => storage.deleteObject(storage.config.privateBucket, key)),
    );
    if (dataRequestId) {
      const row = await prisma.dataRequest.findUnique({ where: { id: dataRequestId } });
      if (row?.exportKey) {
        await storage
          .deleteObject(storage.config.privateBucket, row.exportKey)
          .catch(() => undefined);
      }
    }
    await prisma.message.deleteMany({ where: { senderId: { in: [subjectId, counterpartId] } } });
    await prisma.conversationParticipant.deleteMany({
      where: { userId: { in: [subjectId, counterpartId] } },
    });
    await prisma.quote.deleteMany({ where: { photographerId: profileId } });
    await prisma.request.deleteMany({ where: { clientId: counterpartId } });
    await prisma.notification.deleteMany({ where: { userId: subjectId } });
    await prisma.consentRecord.deleteMany({ where: { userId: subjectId } });
    await prisma.session.deleteMany({ where: { userId: subjectId } });
    await prisma.verificationDocument.deleteMany({ where: { upload: { ownerId: subjectId } } });
    await prisma.verificationCase.deleteMany({ where: { userId: subjectId } });
    await prisma.portfolioImage.deleteMany({ where: { profileId } });
    await prisma.photographerProfile.deleteMany({ where: { id: profileId } });
    await prisma.upload.deleteMany({ where: { ownerId: subjectId } });
    await prisma.auditLog.deleteMany({
      where: { targetType: 'DataRequest', targetId: dataRequestId },
    });
    await prisma.dataRequest.deleteMany({ where: { id: dataRequestId } });
    await prisma.user.deleteMany({ where: { id: { in: [subjectId, counterpartId] } } });
    await prisma.$disconnect();
  });

  it('builds a zip that never leaks the counterpart email and excludes verification document bytes', async () => {
    const processor = createGdprExportProcessor({
      prisma: { client: prisma },
      storage,
      auditLog,
      logger: fakeLogger() as never,
    });

    await processor(fakeJob(dataRequestId));

    const row = await prisma.dataRequest.findUniqueOrThrow({ where: { id: dataRequestId } });
    const expectedExportKey = `gdpr-exports/${dataRequestId}.zip`;
    expect(row.status).toBe('ready');
    expect(row.exportKey).toBe(expectedExportKey);
    expect(row.completedAt).not.toBeNull();
    expect(row.expiresAt).not.toBeNull();

    const zipBuffer = await storage.getObjectBuffer(
      storage.config.privateBucket,
      expectedExportKey,
    );
    const entries = await readZipEntries(zipBuffer);

    const wholeZipText = entries.map((entry) => entry.content.toString('utf8')).join('\n');
    expect(wholeZipText).not.toContain(counterpartEmail);
    expect(wholeZipText).not.toContain(verificationSecret);

    const manifest = jsonOf(entries, 'manifest.json') as { files: Record<string, number> };
    expect(manifest.files['messages.json']).toBe(2);
    expect(manifest.files['portfolio-images.json']).toBe(1);
    expect(manifest.files['verification-cases.json']).toBe(1);
    expect(manifest.files['consents.json']).toBe(1);
    expect(manifest.files['notifications.json']).toBe(1);

    const messages = jsonOf(entries, 'messages.json') as {
      isSelf: boolean;
      counterpart: { name: string; profileSlug: string | null } | null;
      body: string;
    }[];
    expect(messages).toHaveLength(2);
    const fromCounterpart = messages.find((message) => !message.isSelf);
    expect(fromCounterpart?.counterpart?.name).toBe('Fx Export Counterpart');
    expect(fromCounterpart?.counterpart?.profileSlug).toBeNull();
    expect(JSON.stringify(fromCounterpart)).not.toContain(counterpartEmail);

    const verificationCases = jsonOf(entries, 'verification-cases.json') as {
      documents: { documentKey: string; mimeType: string }[];
    }[];
    expect(verificationCases[0]?.documents).toHaveLength(1);
    expect(JSON.stringify(verificationCases)).not.toContain('objectKey');

    const files = entries.filter((entry) => entry.name.startsWith('files/'));
    expect(files).toHaveLength(3);
    expect(textOf(entries, 'files/avatar.webp')).toBe(`avatar-bytes-${runId}`);
    expect(textOf(entries, 'files/cover.png')).toBe(`cover-bytes-${runId}`);
    const portfolioFile = files.find((entry) => entry.name.startsWith('files/portfolio/'));
    expect(portfolioFile?.content.toString('utf8')).toBe(`portfolio-bytes-${runId}`);
    expect(portfolioFile?.name.endsWith('.jpg')).toBe(true);

    const readme = textOf(entries, 'README.txt');
    expect(readme.length).toBeGreaterThan(0);

    const auditRow = await prisma.auditLog.findFirst({
      where: {
        targetType: 'DataRequest',
        targetId: dataRequestId,
        action: 'data_request.export_completed',
      },
    });
    expect(auditRow).not.toBeNull();
  });

  it('builds an export for a client with no photographer profile and no conversations', async () => {
    const clientRunId = `${runId}-client`;
    const clientSubject = await prisma.user.create({
      data: {
        email: `gdpr-export-client-${clientRunId}@photoo.test`,
        name: 'Fx Export Client Subject',
        locale: 'en',
        countryCode: 'LU',
        roles: ['client'],
        status: 'active',
      },
    });

    const ownRequest = await prisma.request.create({
      data: {
        clientId: clientSubject.id,
        title: `Fx Export Client Own Request ${clientRunId}`,
        category: 'portrait',
        description: 'A fixture request owned by the client subject.',
        eventDate: new Date(),
        dateFlexible: false,
        address: { line1: '1 Fixture Way', city: 'Luxembourg', postalCode: 'L-1000' },
        city: 'Luxembourg',
        countryCode: 'LU',
        budgetMinCents: 50000,
        budgetMaxCents: 80000,
        currency: 'EUR',
        usage: 'personal',
        status: 'cancelled',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        deletedAt: new Date(),
      },
    });

    const clientDataRequest = await prisma.dataRequest.create({
      data: { userId: clientSubject.id, type: 'export', status: 'pending' },
    });

    try {
      const processor = createGdprExportProcessor({
        prisma: { client: prisma },
        storage,
        auditLog,
        logger: fakeLogger() as never,
      });

      await processor(fakeJob(clientDataRequest.id));

      const row = await prisma.dataRequest.findUniqueOrThrow({
        where: { id: clientDataRequest.id },
      });
      expect(row.status).toBe('ready');

      const zipBuffer = await storage.getObjectBuffer(
        storage.config.privateBucket,
        row.exportKey ?? '',
      );
      const entries = await readZipEntries(zipBuffer);

      const manifest = jsonOf(entries, 'manifest.json') as { files: Record<string, number> };
      expect(manifest.files['messages.json']).toBe(0);
      expect(manifest.files['photographer-profile.json']).toBe(0);
      expect(manifest.files['products.json']).toBe(0);
      expect(manifest.files['portfolio-images.json']).toBe(0);
      expect(manifest.files['requests.json']).toBe(1);

      const requests = jsonOf(entries, 'requests.json') as { deletedAt: string | null }[];
      expect(requests[0]?.deletedAt).not.toBeNull();

      const profile = jsonOf(entries, 'photographer-profile.json');
      expect(profile).toBeNull();

      const user = jsonOf(entries, 'user.json') as { emailVerifiedAt: string | null };
      expect(user.emailVerifiedAt).toBeNull();
    } finally {
      const row = await prisma.dataRequest.findUnique({ where: { id: clientDataRequest.id } });
      if (row?.exportKey) {
        await storage
          .deleteObject(storage.config.privateBucket, row.exportKey)
          .catch(() => undefined);
      }
      await prisma.auditLog.deleteMany({
        where: { targetType: 'DataRequest', targetId: clientDataRequest.id },
      });
      await prisma.dataRequest.deleteMany({ where: { id: clientDataRequest.id } });
      await prisma.request.deleteMany({ where: { id: ownRequest.id } });
      await prisma.user.deleteMany({ where: { id: clientSubject.id } });
    }
  });
});
