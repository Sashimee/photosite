import type { ConversationParticipant, Message, MessageAttachment, Upload } from '@photoo/db';
import { ConversationSchema, MessageSchema } from '@photoo/shared';
import type { z } from 'zod';
import type { ConversationListRow } from './chat.repository.js';

type AttachmentForMapping = Pick<MessageAttachment, 'id'> & { upload: Pick<Upload, 'mimeType'> };
type MessageForMapping = Pick<
  Message,
  'id' | 'conversationId' | 'senderId' | 'body' | 'editedAt' | 'deletedAt' | 'createdAt'
> & { attachments: AttachmentForMapping[] };

function attachmentKind(mimeType: string): 'image' | 'pdf' | 'other' {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType === 'application/pdf') return 'pdf';
  return 'other';
}

// Blanking happens here, never in the database (S4, docs/COMPLIANCE.md): the
// stored row keeps `body` after a delete, so moderation can still read it;
// every API response and realtime event goes through this mapper instead.
export function mapMessage(message: MessageForMapping): z.infer<typeof MessageSchema> {
  const deleted = message.deletedAt !== null;
  return MessageSchema.parse({
    id: message.id,
    conversationId: message.conversationId,
    senderId: message.senderId,
    body: deleted ? null : message.body,
    attachments: deleted
      ? []
      : message.attachments.map((attachment) => ({
          id: attachment.id,
          kind: attachmentKind(attachment.upload.mimeType),
        })),
    editedAt: message.editedAt ? message.editedAt.toISOString() : null,
    deletedAt: message.deletedAt ? message.deletedAt.toISOString() : null,
    createdAt: message.createdAt.toISOString(),
  });
}

export interface ConversationMappingOptions {
  participants: Pick<ConversationParticipant, 'userId' | 'lastReadAt'>[];
}

export function mapConversationRow(
  row: ConversationListRow,
  options: ConversationMappingOptions,
): z.infer<typeof ConversationSchema> {
  const lastMessagePreview = row.lastMessageDeletedAt ? null : row.lastMessageBody;
  return ConversationSchema.parse({
    id: row.id,
    type: row.type,
    subjectId: row.subjectId,
    participants: options.participants.map((participant) => ({
      userId: participant.userId,
      lastReadAt: participant.lastReadAt ? participant.lastReadAt.toISOString() : null,
    })),
    lastMessageAt: row.lastMessageAt ? row.lastMessageAt.toISOString() : null,
    lastMessagePreview,
    unreadCount: row.unreadCount,
    archivedByMe: row.myArchivedAt !== null,
  });
}
