import type { PrismaClient } from '@photoo/db';
import type { Logger } from 'nestjs-pino';
import type { RecordAuditLogInput } from '../../common/audit-log.service.js';

export interface PurgeChatStorage {
  config: { privateBucket: string };
  deleteObject(bucket: string, key: string): Promise<void>;
}

export interface PurgeChatDeps {
  prisma: { client: PrismaClient };
  storage: PurgeChatStorage;
  auditLog: { record(input: RecordAuditLogInput): Promise<void> };
  logger: Logger;
}

export interface PurgeChatResult {
  messagesDeleted: number;
  attachmentsDeleted: number;
  usersAffected: number;
}

// docs/steps/1A.12-gdpr.md "purge chat 90 days after deletion": a different
// clock than the 30-day anonymisation grace period. Only the deleted user's
// own authored messages and attachments are purged here; the conversation
// and the counterpart's own messages are not the deleted user's data to
// erase, and idempotency falls out for free (a second run finds none left
// to delete for a user already purged, no separate marker column needed).
const CHAT_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

export async function purgeChat(deps: PurgeChatDeps): Promise<PurgeChatResult> {
  const cutoff = new Date(Date.now() - CHAT_RETENTION_MS);

  const deletedUsers = await deps.prisma.client.user.findMany({
    where: { deletedAt: { lte: cutoff } },
    select: { id: true },
  });
  const candidateIds = deletedUsers.map((user) => user.id);
  if (candidateIds.length === 0) {
    deps.logger.log(
      { messagesDeleted: 0, attachmentsDeleted: 0, usersAffected: 0 },
      'gdpr-sweep: purge-chat phase complete',
    );
    return { messagesDeleted: 0, attachmentsDeleted: 0, usersAffected: 0 };
  }

  const messages = await deps.prisma.client.message.findMany({
    where: { senderId: { in: candidateIds } },
    select: {
      id: true,
      senderId: true,
      attachments: { select: { uploadId: true, upload: { select: { objectKey: true } } } },
    },
  });

  const messageIds = messages.map((message) => message.id);
  const affectedUserIds = new Set(messages.map((message) => message.senderId));
  const uploadKeys = messages.flatMap((message) =>
    message.attachments.map((attachment) => attachment.upload.objectKey),
  );
  const uploadIds = messages.flatMap((message) =>
    message.attachments.map((attachment) => attachment.uploadId),
  );

  if (messageIds.length > 0) {
    await deps.prisma.client.message.deleteMany({ where: { id: { in: messageIds } } });
  }
  if (uploadIds.length > 0) {
    await deps.prisma.client.upload.deleteMany({ where: { id: { in: uploadIds } } });
  }
  for (const key of uploadKeys) {
    try {
      await deps.storage.deleteObject(deps.storage.config.privateBucket, key);
    } catch (error) {
      deps.logger.warn(
        { err: error },
        'gdpr-sweep: failed to delete a purged chat attachment object',
      );
    }
  }

  const result: PurgeChatResult = {
    messagesDeleted: messageIds.length,
    attachmentsDeleted: uploadIds.length,
    usersAffected: affectedUserIds.size,
  };

  await deps.auditLog.record({
    actorType: 'system',
    actorId: null,
    action: 'gdpr_sweep.chat_purged',
    targetType: 'Message',
    targetId: null,
    after: result,
  });

  deps.logger.log(result, 'gdpr-sweep: purge-chat phase complete');
  return result;
}
