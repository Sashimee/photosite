import type {
  ConversationParticipant,
  Message,
  MessageAttachment,
  PhotographerProfile,
  Upload,
  User,
} from '@photoo/db';
import { ConversationSchema, MessageSchema } from '@photoo/shared';
import type { z } from 'zod';
import { publicVariantUrl } from '../../storage/public-url.js';
import type { ConversationListRow } from './chat.repository.js';

// Matches the variant key profiles.repository.ts and quotes.repository.ts
// use for avatars, so a chat participant renders the same image as their
// profile card.
const AVATAR_VARIANT_KEY = 'thumb_jpeg';

type AttachmentForMapping = Pick<MessageAttachment, 'id'> & {
  upload: Pick<Upload, 'mimeType' | 'actualSizeBytes' | 'declaredSizeBytes'>;
};
type MessageForMapping = Pick<
  Message,
  'id' | 'conversationId' | 'senderId' | 'body' | 'editedAt' | 'deletedAt' | 'createdAt'
> & { attachments: AttachmentForMapping[] };

type ParticipantUserForMapping = Pick<User, 'id' | 'name'> & {
  photographerProfile:
    | (Pick<PhotographerProfile, 'displayName'> & { avatarUpload: Pick<Upload, 'variants'> | null })
    | null;
};

function attachmentKind(mimeType: string): 'image' | 'pdf' | 'other' {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType === 'application/pdf') return 'pdf';
  return 'other';
}

function attachmentSizeBytes(
  upload: Pick<Upload, 'actualSizeBytes' | 'declaredSizeBytes'>,
): number {
  return upload.actualSizeBytes ?? upload.declaredSizeBytes;
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
          mimeType: attachment.upload.mimeType,
          sizeBytes: attachmentSizeBytes(attachment.upload),
        })),
    editedAt: message.editedAt ? message.editedAt.toISOString() : null,
    deletedAt: message.deletedAt ? message.deletedAt.toISOString() : null,
    createdAt: message.createdAt.toISOString(),
  });
}

export interface ConversationMappingOptions {
  participants: (Pick<ConversationParticipant, 'userId' | 'lastReadAt'> & {
    user: ParticipantUserForMapping;
  })[];
}

// A client has no PhotographerProfile, so their public identity falls back
// to `User.name` (DATA-MODEL.md: the account's own display name). A
// photographer's profile identity takes priority so both parties see the
// same name and picture chat uses elsewhere on the site.
function mapParticipantUser(
  user: ParticipantUserForMapping,
  baseUrl: string,
): z.infer<typeof ConversationSchema>['participants'][number]['user'] {
  const avatarVariants =
    (user.photographerProfile?.avatarUpload?.variants as Record<string, string> | null) ?? null;
  return {
    id: user.id,
    displayName: user.photographerProfile?.displayName ?? user.name ?? '',
    avatarUrl: user.photographerProfile
      ? publicVariantUrl(baseUrl, avatarVariants, AVATAR_VARIANT_KEY)
      : null,
  };
}

function mapSubjectRef(row: ConversationListRow): z.infer<typeof ConversationSchema>['subjectRef'] {
  if (row.type !== 'quote' || row.subjectId === null) {
    return null;
  }
  return {
    type: 'quote',
    quoteId: row.subjectId,
    requestTitle: row.subjectRequestTitle ?? undefined,
  };
}

export function mapConversationRow(
  row: ConversationListRow,
  options: ConversationMappingOptions,
  baseUrl: string,
): z.infer<typeof ConversationSchema> {
  const lastMessagePreview = row.lastMessageDeletedAt ? null : row.lastMessageBody;
  return ConversationSchema.parse({
    id: row.id,
    type: row.type,
    subjectId: row.subjectId,
    subjectRef: mapSubjectRef(row),
    participants: options.participants.map((participant) => ({
      userId: participant.userId,
      user: mapParticipantUser(participant.user, baseUrl),
      lastReadAt: participant.lastReadAt ? participant.lastReadAt.toISOString() : null,
    })),
    lastMessageAt: row.lastMessageAt ? row.lastMessageAt.toISOString() : null,
    lastMessagePreview,
    unreadCount: row.unreadCount,
    archivedByMe: row.myArchivedAt !== null,
  });
}
