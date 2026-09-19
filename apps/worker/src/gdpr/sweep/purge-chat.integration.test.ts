import { randomUUID } from 'node:crypto';
import { createPrismaClient, type PrismaClient } from '@photoo/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditLogService } from '../../common/audit-log.service.js';
import { StorageService } from '../../storage/storage.service.js';
import { requireIntegrationEnv } from '../../testing/require-integration-env.js';
import { TEST_ENV } from '../../testing/test-env.js';
import { purgeChat } from './purge-chat.js';

const testEnv = requireIntegrationEnv(['TEST_DATABASE_URL']);

function fakeLogger() {
  return { log: () => undefined, warn: () => undefined, error: () => undefined };
}

const NINETY_ONE_DAYS_AGO = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000);
const ONE_DAY_AGO = new Date(Date.now() - 24 * 60 * 60 * 1000);

describe('purgeChat against a real database and MinIO', () => {
  if (!testEnv) {
    it.skip('skipped: TEST_DATABASE_URL is not set', () => undefined);
    return;
  }

  let prisma: PrismaClient;
  let auditLog: AuditLogService;
  const storage = new StorageService(TEST_ENV);
  const runId = randomUUID().replaceAll('-', '').slice(0, 8);

  let dueUserId: string;
  let notDueUserId: string;
  let otherPartyId: string;
  let conversationDueId: string;
  let conversationNotDueId: string;
  let attachmentObjectKey: string;
  let dueMessageId: string;
  let counterpartMessageId: string;
  let notDueMessageId: string;

  beforeAll(async () => {
    prisma = createPrismaClient(testEnv.TEST_DATABASE_URL);
    auditLog = new AuditLogService({ client: prisma } as never);

    const dueUser = await prisma.user.create({
      data: {
        email: `gdpr-chat-due-${runId}@photoo.test`,
        name: 'Fx Chat Due',
        locale: 'en',
        countryCode: 'LU',
        roles: ['client'],
        status: 'deleted',
        deletedAt: NINETY_ONE_DAYS_AGO,
      },
    });
    dueUserId = dueUser.id;

    const notDueUser = await prisma.user.create({
      data: {
        email: `gdpr-chat-notdue-${runId}@photoo.test`,
        name: 'Fx Chat Not Due',
        locale: 'en',
        countryCode: 'LU',
        roles: ['client'],
        status: 'deleted',
        deletedAt: ONE_DAY_AGO,
      },
    });
    notDueUserId = notDueUser.id;

    const otherParty = await prisma.user.create({
      data: {
        email: `gdpr-chat-other-${runId}@photoo.test`,
        name: 'Fx Chat Other Party',
        locale: 'en',
        countryCode: 'LU',
        roles: ['photographer'],
        status: 'active',
      },
    });
    otherPartyId = otherParty.id;

    const conversationDue = await prisma.conversation.create({
      data: { type: 'direct', subjectId: `fx-chat-due-${runId}` },
    });
    conversationDueId = conversationDue.id;
    await prisma.conversationParticipant.createMany({
      data: [
        { conversationId: conversationDueId, userId: dueUserId },
        { conversationId: conversationDueId, userId: otherPartyId },
      ],
    });

    attachmentObjectKey = `worker-gdpr-chat-test/${runId}/attachment.jpg`;
    await storage.putObject({
      bucket: storage.config.privateBucket,
      key: attachmentObjectKey,
      body: Buffer.from('attachment-bytes'),
      contentType: 'image/jpeg',
    });
    const upload = await prisma.upload.create({
      data: {
        ownerId: dueUserId,
        purpose: 'chat_attachment',
        status: 'processed',
        mimeType: 'image/jpeg',
        declaredSizeBytes: 10,
        actualSizeBytes: 10,
        objectKey: attachmentObjectKey,
        virusScanStatus: 'clean',
      },
    });

    const dueMessage = await prisma.message.create({
      data: { conversationId: conversationDueId, senderId: dueUserId, body: 'past retention' },
    });
    dueMessageId = dueMessage.id;
    await prisma.messageAttachment.create({
      data: { messageId: dueMessageId, uploadId: upload.id },
    });

    const counterpartMessage = await prisma.message.create({
      data: {
        conversationId: conversationDueId,
        senderId: otherPartyId,
        body: 'kept, not deleted',
      },
    });
    counterpartMessageId = counterpartMessage.id;

    const conversationNotDue = await prisma.conversation.create({
      data: { type: 'direct', subjectId: `fx-chat-notdue-${runId}` },
    });
    conversationNotDueId = conversationNotDue.id;
    await prisma.conversationParticipant.createMany({
      data: [
        { conversationId: conversationNotDueId, userId: notDueUserId },
        { conversationId: conversationNotDueId, userId: otherPartyId },
      ],
    });
    const notDueMessage = await prisma.message.create({
      data: {
        conversationId: conversationNotDueId,
        senderId: notDueUserId,
        body: 'within retention',
      },
    });
    notDueMessageId = notDueMessage.id;
  });

  afterAll(async () => {
    await storage
      .deleteObject(storage.config.privateBucket, attachmentObjectKey)
      .catch(() => undefined);
    await prisma.message.deleteMany({
      where: { id: { in: [dueMessageId, counterpartMessageId, notDueMessageId] } },
    });
    await prisma.conversationParticipant.deleteMany({
      where: { conversationId: { in: [conversationDueId, conversationNotDueId] } },
    });
    await prisma.conversation.deleteMany({
      where: { id: { in: [conversationDueId, conversationNotDueId] } },
    });
    await prisma.upload.deleteMany({ where: { ownerId: dueUserId } });
    await prisma.auditLog.deleteMany({
      where: { targetType: 'Message', action: 'gdpr_sweep.chat_purged' },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [dueUserId, notDueUserId, otherPartyId] } },
    });
    await prisma.$disconnect();
  });

  it('purges only the sender-authored messages and attachments past 90 days', async () => {
    const result = await purgeChat({
      prisma: { client: prisma },
      storage,
      auditLog,
      logger: fakeLogger() as never,
    });

    expect(result.messagesDeleted).toBeGreaterThanOrEqual(1);
    expect(result.attachmentsDeleted).toBeGreaterThanOrEqual(1);

    const dueMessage = await prisma.message.findUnique({ where: { id: dueMessageId } });
    expect(dueMessage).toBeNull();

    const counterpartMessage = await prisma.message.findUnique({
      where: { id: counterpartMessageId },
    });
    expect(counterpartMessage).not.toBeNull();

    const notDueMessage = await prisma.message.findUnique({ where: { id: notDueMessageId } });
    expect(notDueMessage).not.toBeNull();

    const uploads = await prisma.upload.findMany({ where: { ownerId: dueUserId } });
    expect(uploads).toHaveLength(0);
    await expect(
      storage.getObjectBuffer(storage.config.privateBucket, attachmentObjectKey),
    ).rejects.toThrow();

    const auditRow = await prisma.auditLog.findFirst({
      where: { targetType: 'Message', action: 'gdpr_sweep.chat_purged' },
      orderBy: { occurredAt: 'desc' },
    });
    expect(auditRow).not.toBeNull();
  });
});
