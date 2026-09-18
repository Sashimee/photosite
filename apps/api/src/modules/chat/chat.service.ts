import { HttpException, Inject, Injectable } from '@nestjs/common';
import { Prisma, type ConversationParticipant, type Upload } from '@photoo/db';
import {
  SERVER_SOCKET_EVENTS,
  truncateNotificationText,
  type ConversationSchema,
  type ConversationsQuerySchema,
  type ConversationsUnreadCountResponseSchema,
  type CursorPaginationQuerySchema,
  type MarkConversationReadRequestSchema,
  type MessageSchema,
  type ReportConversationRequestSchema,
  type SendMessageRequestSchema,
} from '@photoo/shared';
import { Logger } from 'nestjs-pino';
import type { z } from 'zod';
import { AuditLogService } from '../../common/audit/audit-log.service.js';
import {
  decodeCreatedAtCursor,
  encodeCreatedAtCursor,
} from '../../common/pagination/created-at-cursor.js';
import { APP_CONFIG, type Env } from '../../config/env.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { StorageService } from '../../storage/storage.service.js';
import { ChatMembershipCache } from './chat-membership-cache.js';
import { mapConversationRow, mapMessage } from './chat-mapper.js';
import { ChatPresenceService } from './chat-presence.service.js';
import { ChatPushCollapseService } from './chat-push-collapse.service.js';
import { ChatRateLimitService } from './chat-rate-limit.service.js';
import { conversationRoom, userRoom, ChatSocketBridge } from './chat-socket-bridge.js';
import { ChatRepository, type ConversationListRow } from './chat.repository.js';
import { decodeConversationCursor, encodeConversationCursor } from './conversation-cursor.js';
import { NotificationsService } from '../notifications/notifications.service.js';

interface SessionUser {
  id: string;
}

type ConversationsQuery = z.infer<typeof ConversationsQuerySchema>;
type MessagesQuery = z.infer<typeof CursorPaginationQuerySchema>;
type SendMessageInput = z.infer<typeof SendMessageRequestSchema>;
type MarkReadInput = z.infer<typeof MarkConversationReadRequestSchema>;
type ReportInput = z.infer<typeof ReportConversationRequestSchema>;
type ConversationDto = z.infer<typeof ConversationSchema>;
type MessageDto = z.infer<typeof MessageSchema>;
type UnreadCountDto = z.infer<typeof ConversationsUnreadCountResponseSchema>;

const MESSAGE_ATTACHMENTS_INCLUDE = {
  attachments: {
    include: {
      upload: { select: { mimeType: true, actualSizeBytes: true, declaredSizeBytes: true } },
    },
  },
} as const;

// `User.name` is never selected here: it defaults to the account's email
// local part at sign-up and must never reach another participant
// (S6/compliance, quote-events.ts), so a client participant's displayName
// stays null rather than falling back to it.
const PARTICIPANT_USER_SELECT = {
  user: {
    select: {
      id: true,
      photographerProfile: {
        select: { displayName: true, avatarUpload: { select: { variants: true } } },
      },
    },
  },
} as const;

const DELETE_WINDOW_MS = 15 * 60 * 1000;
const ATTACHMENT_GET_URL_EXPIRY_SECONDS = 5 * 60;

function notFound(message = 'Conversation not found'): HttpException {
  return new HttpException({ code: 'NOT_FOUND', message }, 404);
}

function badRequest(message: string): HttpException {
  return new HttpException({ code: 'BAD_REQUEST', message }, 400);
}

function forbidden(message: string): HttpException {
  return new HttpException({ code: 'FORBIDDEN', message }, 403);
}

function conflict(message: string): HttpException {
  return new HttpException({ code: 'CONFLICT', message }, 409);
}

function unprocessable(message: string): HttpException {
  return new HttpException({ code: 'UNPROCESSABLE_ENTITY', message }, 422);
}

function isUploadReady(upload: Pick<Upload, 'status' | 'virusScanStatus'>): boolean {
  return (
    upload.virusScanStatus === 'clean' &&
    (upload.status === 'clean' || upload.status === 'processed')
  );
}

function isDuplicateKeyError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

@Injectable()
export class ChatService {
  private readonly baseUrl: string;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(StorageService) private readonly storage: StorageService,
    @Inject(ChatRepository) private readonly repository: ChatRepository,
    @Inject(ChatMembershipCache) private readonly membershipCache: ChatMembershipCache,
    @Inject(ChatRateLimitService) private readonly rateLimit: ChatRateLimitService,
    @Inject(ChatSocketBridge) private readonly bridge: ChatSocketBridge,
    @Inject(ChatPresenceService) private readonly presence: ChatPresenceService,
    @Inject(ChatPushCollapseService) private readonly pushCollapse: ChatPushCollapseService,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
    @Inject(AuditLogService) private readonly auditLog: AuditLogService,
    @Inject(Logger) private readonly logger: Logger,
    @Inject(APP_CONFIG) config: Env,
  ) {
    this.baseUrl = config.S3_PUBLIC_BASE_URL;
  }

  // Creates the (idempotent) quote conversation inside the caller's own
  // quote-creation transaction (docs/steps/1A.6-chat.md "created in the same
  // transaction as the quote").
  async createQuoteConversation(
    tx: Prisma.TransactionClient,
    quoteId: string,
    participantUserIds: readonly string[],
  ): Promise<void> {
    const existing = await tx.conversation.findUnique({
      where: { type_subjectId: { type: 'quote', subjectId: quoteId } },
    });
    if (existing) {
      return;
    }
    await tx.conversation.create({
      data: {
        type: 'quote',
        subjectId: quoteId,
        participants: { create: participantUserIds.map((userId) => ({ userId })) },
      },
    });
    for (const userId of participantUserIds) {
      await this.membershipCache.invalidate(quoteId, userId);
    }
  }

  async list(
    user: SessionUser,
    query: ConversationsQuery,
  ): Promise<{ items: ConversationDto[]; nextCursor: string | null }> {
    await this.rateLimit.enforceRead(user.id);
    const cursor = query.cursor ? decodeConversationCursor(query.cursor) : undefined;
    const archived = query.archived === true;

    const rows = await this.repository.listConversations(
      user.id,
      archived,
      query.limit + 1,
      cursor,
    );

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const items = await this.toDtos(page, user.id);
    const last = page[page.length - 1];
    const nextCursor =
      hasMore && last ? encodeConversationCursor(last.lastMessageAt, last.id) : null;
    return { items, nextCursor };
  }

  async unreadCount(user: SessionUser): Promise<UnreadCountDto> {
    await this.rateLimit.enforceRead(user.id);
    const count = await this.repository.countUnreadMessages(user.id);
    return { count };
  }

  async get(user: SessionUser, id: string): Promise<ConversationDto> {
    await this.rateLimit.enforceRead(user.id);
    const row = await this.repository.getConversation(user.id, id);
    if (!row) {
      throw notFound();
    }
    const [dto] = await this.toDtos([row], user.id);
    if (!dto) {
      throw notFound();
    }
    return dto;
  }

  async listMessages(
    user: SessionUser,
    conversationId: string,
    query: MessagesQuery,
  ): Promise<{ items: MessageDto[]; nextCursor: string | null }> {
    await this.requireParticipant(conversationId, user.id);
    await this.rateLimit.enforceRead(user.id);

    const cursor = query.cursor ? decodeCreatedAtCursor(query.cursor) : undefined;
    const rows = await this.prisma.client.message.findMany({
      where: {
        conversationId,
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: cursor.createdAt } },
                { createdAt: cursor.createdAt, id: { gt: cursor.id } },
              ],
            }
          : {}),
      },
      include: MESSAGE_ATTACHMENTS_INCLUDE,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: query.limit + 1,
    });

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const last = page[page.length - 1];
    const nextCursor = hasMore && last ? encodeCreatedAtCursor(last.createdAt, last.id) : null;
    return { items: page.map(mapMessage), nextCursor };
  }

  async sendMessage(
    user: SessionUser,
    conversationId: string,
    input: SendMessageInput,
    ip?: string,
  ): Promise<MessageDto> {
    await this.requireParticipant(conversationId, user.id);
    await this.rateLimit.enforceSendMessage(user.id, ip);

    const attachmentUploads = await this.validateAttachments(user.id, input.attachmentIds);

    let created;
    try {
      created = await this.prisma.client.$transaction(async (tx) => {
        const message = await tx.message.create({
          data: {
            conversationId,
            senderId: user.id,
            body: input.body ?? null,
            ...(attachmentUploads.length > 0
              ? {
                  attachments: {
                    create: attachmentUploads.map((upload) => ({ uploadId: upload.id })),
                  },
                }
              : {}),
          },
          include: MESSAGE_ATTACHMENTS_INCLUDE,
        });

        await tx.conversation.updateMany({
          where: {
            id: conversationId,
            OR: [{ lastMessageAt: null }, { lastMessageAt: { lt: message.createdAt } }],
          },
          data: { lastMessageAt: message.createdAt },
        });

        await tx.conversationParticipant.updateMany({
          where: { conversationId, userId: { not: user.id }, archivedAt: { not: null } },
          data: { archivedAt: null },
        });

        return message;
      });
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw unprocessable('An attachment can only be used in one message');
      }
      throw error;
    }

    const dto = mapMessage(created);
    const participants = await this.prisma.client.conversationParticipant.findMany({
      where: { conversationId },
    });

    this.bridge.emitToRooms(
      [conversationRoom(conversationId), ...participants.map((p) => userRoom(p.userId))],
      SERVER_SOCKET_EVENTS.MESSAGE_NEW,
      { message: dto },
    );
    for (const participant of participants.filter((p) => p.userId !== user.id)) {
      const conversationDto = await this.getForParticipant(conversationId, participant);
      if (conversationDto) {
        this.bridge.emitToRooms(
          [userRoom(participant.userId)],
          SERVER_SOCKET_EVENTS.CONVERSATION_UPDATED,
          { conversation: conversationDto },
        );
      }
    }

    this.notifyRecipients(conversationId, participants, user.id).catch((error: unknown) => {
      this.logger.error(
        { err: error, conversationId },
        'chat: failed to notify offline recipients',
      );
    });

    return dto;
  }

  async deleteMessage(
    user: SessionUser,
    conversationId: string,
    messageId: string,
  ): Promise<MessageDto> {
    await this.requireParticipant(conversationId, user.id);

    const message = await this.prisma.client.message.findUnique({
      where: { id: messageId },
      include: MESSAGE_ATTACHMENTS_INCLUDE,
    });
    if (message?.conversationId !== conversationId) {
      throw notFound('Message not found');
    }
    if (message.senderId !== user.id) {
      throw forbidden('You can only delete your own messages');
    }
    if (message.deletedAt) {
      return mapMessage(message);
    }
    if (Date.now() - message.createdAt.getTime() > DELETE_WINDOW_MS) {
      throw conflict('The window to delete this message has passed');
    }

    // The body column is never cleared (S4, docs/COMPLIANCE.md): only the
    // mapper blanks it for API responses and events, so a moderator can
    // still read a deleted message's content within the retention window.
    const updated = await this.prisma.client.message.update({
      where: { id: messageId },
      data: { deletedAt: new Date() },
      include: MESSAGE_ATTACHMENTS_INCLUDE,
    });
    const dto = mapMessage(updated);

    const participants = await this.prisma.client.conversationParticipant.findMany({
      where: { conversationId },
    });
    this.bridge.emitToRooms(
      [conversationRoom(conversationId), ...participants.map((p) => userRoom(p.userId))],
      SERVER_SOCKET_EVENTS.MESSAGE_DELETED,
      { message: dto },
    );
    for (const participant of participants) {
      const conversationDto = await this.getForParticipant(conversationId, participant);
      if (conversationDto) {
        this.bridge.emitToRooms(
          [userRoom(participant.userId)],
          SERVER_SOCKET_EVENTS.CONVERSATION_UPDATED,
          { conversation: conversationDto },
        );
      }
    }

    return dto;
  }

  async markRead(
    user: SessionUser,
    conversationId: string,
    input: MarkReadInput,
  ): Promise<ConversationDto> {
    const participant = await this.requireParticipant(conversationId, user.id);

    const message = await this.prisma.client.message.findUnique({
      where: { id: input.upToMessageId },
    });
    if (message?.conversationId !== conversationId) {
      throw badRequest('upToMessageId does not belong to this conversation');
    }

    const newLastReadAt =
      participant.lastReadAt && participant.lastReadAt >= message.createdAt
        ? participant.lastReadAt
        : message.createdAt;

    await this.prisma.client.conversationParticipant.update({
      where: { conversationId_userId: { conversationId, userId: user.id } },
      data: { lastReadAt: newLastReadAt },
    });

    this.bridge.emitToRooms([conversationRoom(conversationId)], SERVER_SOCKET_EVENTS.READ, {
      conversationId,
      userId: user.id,
      upToMessageId: input.upToMessageId,
    });

    const dto = await this.get(user, conversationId);
    this.bridge.emitToRooms([userRoom(user.id)], SERVER_SOCKET_EVENTS.CONVERSATION_UPDATED, {
      conversation: dto,
    });
    return dto;
  }

  async archive(user: SessionUser, conversationId: string): Promise<ConversationDto> {
    return this.setArchived(user, conversationId, true);
  }

  async unarchive(user: SessionUser, conversationId: string): Promise<ConversationDto> {
    return this.setArchived(user, conversationId, false);
  }

  async report(user: SessionUser, conversationId: string, input: ReportInput): Promise<void> {
    await this.requireParticipant(conversationId, user.id);
    await this.rateLimit.enforceReport(user.id);

    let reportedMessage: { id: string; body: string | null } | null = null;
    if (input.messageId) {
      const message = await this.prisma.client.message.findUnique({
        where: { id: input.messageId },
      });
      if (message?.conversationId !== conversationId) {
        throw badRequest('messageId does not belong to this conversation');
      }
      reportedMessage = { id: message.id, body: message.body };
    }

    // The snapshot keeps the reported message's own body (S4): unlike the
    // blanked API/event view, moderation reviewing this report needs to see
    // what was actually said, even if the sender later deletes it.
    await this.auditLog.record({
      actorType: 'user',
      actorId: user.id,
      action: 'chat.reported',
      targetType: 'Conversation',
      targetId: conversationId,
      after: {
        reason: input.reason,
        messageId: reportedMessage?.id ?? null,
        messageBody: reportedMessage?.body ?? null,
      },
    });
    this.logger.warn(
      { conversationId, reporterId: user.id, messageId: input.messageId ?? null },
      'chat: conversation reported',
    );
  }

  async getAttachmentDownloadUrl(
    user: SessionUser,
    conversationId: string,
    messageId: string,
    attachmentId: string,
  ): Promise<{ url: string; expiresAt: string }> {
    await this.requireParticipant(conversationId, user.id);

    const attachment = await this.prisma.client.messageAttachment.findUnique({
      where: { id: attachmentId },
      include: { message: true, upload: true },
    });
    if (
      attachment?.messageId !== messageId ||
      attachment.message.conversationId !== conversationId ||
      attachment.message.deletedAt !== null
    ) {
      throw notFound('Attachment not found');
    }

    const upload = attachment.upload;
    if (!isUploadReady(upload)) {
      throw conflict('Attachment is not available for download yet');
    }

    const url = await this.storage.presignGet({
      bucket: this.storage.config.privateBucket,
      key: upload.objectKey,
      expiresInSeconds: ATTACHMENT_GET_URL_EXPIRY_SECONDS,
      responseContentType: upload.mimeType,
      ...(upload.status === 'processed' ? {} : { responseContentDisposition: 'attachment' }),
    });
    return {
      url,
      expiresAt: new Date(Date.now() + ATTACHMENT_GET_URL_EXPIRY_SECONDS * 1000).toISOString(),
    };
  }

  // Used by the socket gateway for `conversation:join` and the `typing`
  // relay, which don't otherwise touch the database.
  async isParticipant(conversationId: string, userId: string): Promise<boolean> {
    const cached = await this.membershipCache.isMember(conversationId, userId);
    if (cached !== undefined) {
      return cached;
    }
    const participant = await this.prisma.client.conversationParticipant.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
    });
    if (participant) {
      await this.membershipCache.markMember(conversationId, userId);
      return true;
    }
    return false;
  }

  private async setArchived(
    user: SessionUser,
    conversationId: string,
    archived: boolean,
  ): Promise<ConversationDto> {
    await this.requireParticipant(conversationId, user.id);
    await this.prisma.client.conversationParticipant.update({
      where: { conversationId_userId: { conversationId, userId: user.id } },
      data: { archivedAt: archived ? new Date() : null },
    });

    const dto = await this.get(user, conversationId);
    this.bridge.emitToRooms([userRoom(user.id)], SERVER_SOCKET_EVENTS.CONVERSATION_UPDATED, {
      conversation: dto,
    });
    return dto;
  }

  private async requireParticipant(
    conversationId: string,
    userId: string,
  ): Promise<ConversationParticipant> {
    const participant = await this.prisma.client.conversationParticipant.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
    });
    if (!participant) {
      throw notFound();
    }
    return participant;
  }

  private async validateAttachments(
    userId: string,
    attachmentIds: string[] | undefined,
  ): Promise<Upload[]> {
    if (!attachmentIds || attachmentIds.length === 0) {
      return [];
    }

    const uploads = await this.prisma.client.upload.findMany({
      where: { id: { in: attachmentIds } },
    });
    if (uploads.length !== attachmentIds.length) {
      throw unprocessable('One or more attachments were not found');
    }
    for (const upload of uploads) {
      if (upload.ownerId !== userId) {
        throw unprocessable('You can only attach your own uploads');
      }
      if (upload.purpose !== 'chat_attachment') {
        throw unprocessable('Only chat attachments can be attached to a message');
      }
      if (!isUploadReady(upload)) {
        throw unprocessable('An attachment has not finished scanning yet');
      }
    }

    const alreadyAttached = await this.prisma.client.messageAttachment.count({
      where: { uploadId: { in: attachmentIds } },
    });
    if (alreadyAttached > 0) {
      throw unprocessable('An attachment can only be used in one message');
    }

    return uploads;
  }

  private async toDtos(rows: ConversationListRow[], userId: string): Promise<ConversationDto[]> {
    if (rows.length === 0) {
      return [];
    }
    const participants = await this.prisma.client.conversationParticipant.findMany({
      where: { conversationId: { in: rows.map((row) => row.id) } },
      include: PARTICIPANT_USER_SELECT,
    });
    const byConversation = new Map<string, typeof participants>();
    for (const participant of participants) {
      const list = byConversation.get(participant.conversationId) ?? [];
      list.push(participant);
      byConversation.set(participant.conversationId, list);
    }

    const dtos: ConversationDto[] = [];
    for (const row of rows) {
      const rowParticipants = byConversation.get(row.id) ?? [];
      if (!rowParticipants.some((p) => p.userId === userId)) {
        continue;
      }
      dtos.push(mapConversationRow(row, { participants: rowParticipants }, this.baseUrl));
    }
    return dtos;
  }

  private async getForParticipant(
    conversationId: string,
    participant: Pick<ConversationParticipant, 'userId'>,
  ): Promise<ConversationDto | null> {
    const row = await this.repository.getConversation(participant.userId, conversationId);
    if (!row) {
      return null;
    }
    const [dto] = await this.toDtos([row], participant.userId);
    return dto ?? null;
  }

  private async notifyRecipients(
    conversationId: string,
    participants: ConversationParticipant[],
    senderId: string,
  ): Promise<void> {
    const recipients = participants.filter((p) => p.userId !== senderId);
    if (recipients.length === 0) {
      return;
    }
    const counterpartName = await this.resolveSenderDisplayName(senderId);

    for (const recipient of recipients) {
      const online = await this.presence.isOnline(recipient.userId);
      if (online) {
        continue;
      }
      const shouldSend = await this.pushCollapse.shouldSend(conversationId, recipient.userId);
      if (!shouldSend) {
        continue;
      }
      try {
        await this.notifications.notify(recipient.userId, 'message_received', {
          conversationId,
          counterpartName,
        });
      } catch (error) {
        await this.pushCollapse.clear(conversationId, recipient.userId);
        this.logger.error(
          { err: error, conversationId, recipientId: recipient.userId },
          'chat: failed to notify an offline recipient',
        );
      }
    }
  }

  private async resolveSenderDisplayName(senderId: string): Promise<string | undefined> {
    const profile = await this.prisma.client.photographerProfile.findUnique({
      where: { userId: senderId },
    });
    return profile ? truncateNotificationText(profile.displayName) : undefined;
  }
}
