import {
  ConversationSchema,
  MAX_ATTACHMENTS_PER_MESSAGE,
  MessageBodySchema,
  MessageSchema,
  atLeastOneOfBodyOrAttachments,
} from './chat.js';
import { IdSchema } from './common.js';
import { z } from './zod.js';

export const SocketHandshakeAuthSchema = z
  .object({
    token: z.string().min(1).optional(),
  })
  .strict();

export const ClientConversationJoinEventSchema = z
  .object({
    conversationId: IdSchema,
  })
  .strict();

export const ClientMessageSendEventSchema = z
  .object({
    conversationId: IdSchema,
    body: MessageBodySchema.optional(),
    attachmentIds: z.array(IdSchema).min(1).max(MAX_ATTACHMENTS_PER_MESSAGE).optional(),
  })
  .strict()
  .refine(atLeastOneOfBodyOrAttachments, {
    message: 'provide a body, at least one attachment id, or both',
    path: ['body'],
  });

export const ClientTypingEventSchema = z
  .object({
    conversationId: IdSchema,
    isTyping: z.boolean(),
  })
  .strict();

export const ClientReadEventSchema = z
  .object({
    conversationId: IdSchema,
    upToMessageId: IdSchema,
  })
  .strict();

export const ServerMessageNewEventSchema = z
  .object({
    message: MessageSchema,
  })
  .strict();

export const ServerMessageDeletedEventSchema = z
  .object({
    message: MessageSchema,
  })
  .strict();

export const ServerTypingEventSchema = z
  .object({
    conversationId: IdSchema,
    userId: IdSchema,
    isTyping: z.boolean(),
  })
  .strict();

export const ServerReadEventSchema = z
  .object({
    conversationId: IdSchema,
    userId: IdSchema,
    upToMessageId: IdSchema,
  })
  .strict();

export const ServerConversationUpdatedEventSchema = z
  .object({
    conversation: ConversationSchema,
  })
  .strict();

export const CLIENT_SOCKET_EVENTS = {
  CONVERSATION_JOIN: 'conversation:join',
  MESSAGE_SEND: 'message:send',
  TYPING: 'typing',
  READ: 'read',
} as const;

export const SERVER_SOCKET_EVENTS = {
  MESSAGE_NEW: 'message:new',
  MESSAGE_DELETED: 'message:deleted',
  TYPING: 'typing',
  READ: 'read',
  CONVERSATION_UPDATED: 'conversation:updated',
} as const;

export interface SocketAckError {
  code: string;
  message: string;
}

// Every ack callback resolves with this envelope instead of throwing, so an
// invalid payload or a rejected action reaches the client as data, not a
// dropped connection.
export type SocketAck<T> = { ok: true; data: T } | { ok: false; error: SocketAckError };
