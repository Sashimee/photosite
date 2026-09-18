import { ATTACHMENT_KINDS, CONVERSATION_TYPES } from '../enums.js';
import {
  CursorPaginationQuerySchema,
  IdSchema,
  IsoDateTimeSchema,
  errorResponses,
  paginatedResponseSchema,
} from './common.js';
import { AUTH_SECURITY, apiPath, registry } from './registry.js';
import { MimeTypeSchema, UploadDownloadResponseSchema } from './uploads.js';
import { z } from './zod.js';

export const MessageAttachmentSchema = z
  .object({
    id: IdSchema,
    kind: z.enum(ATTACHMENT_KINDS),
    mimeType: MimeTypeSchema,
    sizeBytes: z.int().positive(),
  })
  .strict()
  .openapi('MessageAttachment');

export const MessageSchema = z
  .object({
    id: IdSchema,
    conversationId: IdSchema,
    senderId: IdSchema,
    body: z.string().max(4000).nullable(),
    attachments: z.array(MessageAttachmentSchema),
    editedAt: IsoDateTimeSchema.nullable(),
    deletedAt: IsoDateTimeSchema.nullable(),
    createdAt: IsoDateTimeSchema,
  })
  .strict()
  .openapi('Message');

export const ConversationParticipantUserSchema = z
  .object({
    id: IdSchema,
    // Null for a participant with no PhotographerProfile (a client): their
    // only other name, User.name, defaults to their email local part at
    // sign-up (S6/compliance) and must never reach another participant.
    displayName: z.string().max(120).nullable(),
    avatarUrl: z.url().nullable(),
  })
  .strict()
  .openapi('ConversationParticipantUser');

export const ConversationParticipantSchema = z
  .object({
    userId: IdSchema,
    user: ConversationParticipantUserSchema,
    lastReadAt: IsoDateTimeSchema.nullable(),
  })
  .strict()
  .openapi('ConversationParticipant');

export const QuoteConversationSubjectRefSchema = z
  .object({
    type: z.literal('quote'),
    quoteId: IdSchema,
    requestTitle: z.string().min(1).max(150).optional(),
  })
  .strict()
  .openapi('QuoteConversationSubjectRef');

export const ConversationSubjectRefSchema = z.discriminatedUnion('type', [
  QuoteConversationSubjectRefSchema,
]);

export const ConversationSchema = z
  .object({
    id: IdSchema,
    type: z.enum(CONVERSATION_TYPES),
    subjectId: IdSchema.nullable(),
    subjectRef: ConversationSubjectRefSchema.nullable(),
    participants: z.array(ConversationParticipantSchema).min(1),
    lastMessageAt: IsoDateTimeSchema.nullable(),
    lastMessagePreview: z.string().max(4000).nullable(),
    unreadCount: z.int().nonnegative(),
    archivedByMe: z.boolean(),
  })
  .strict()
  .openapi('Conversation');

export const ConversationsUnreadCountResponseSchema = z
  .object({ count: z.int().nonnegative() })
  .strict()
  .openapi('ConversationsUnreadCount');

export const MAX_ATTACHMENTS_PER_MESSAGE = 10;
export const MAX_MESSAGE_BODY_LENGTH = 4000;

// Every C0/C1 control byte except tab and newline: chat is plain text
// (docs/steps/1A.6-chat.md "Plain text only"), so nothing a terminal or a
// client's renderer could misinterpret (CR, NUL, escape sequences, ...)
// belongs in a message body.
// eslint-disable-next-line no-control-regex -- rejecting control characters is the point.
const DISALLOWED_CONTROL_CHARS = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/;

export const MessageBodySchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_MESSAGE_BODY_LENGTH)
  .refine((value) => !DISALLOWED_CONTROL_CHARS.test(value), {
    message: 'body must not contain control characters other than newline and tab',
  });

export function atLeastOneOfBodyOrAttachments(data: {
  body?: string | undefined;
  attachmentIds?: string[] | undefined;
}) {
  const hasBody = data.body !== undefined && data.body.length > 0;
  const hasAttachments = data.attachmentIds !== undefined && data.attachmentIds.length > 0;
  return hasBody || hasAttachments;
}

export const SendMessageRequestSchema = z
  .object({
    body: MessageBodySchema.optional(),
    attachmentIds: z.array(IdSchema).min(1).max(MAX_ATTACHMENTS_PER_MESSAGE).optional(),
  })
  .strict()
  .refine(atLeastOneOfBodyOrAttachments, {
    message: 'provide a body, at least one attachment id, or both',
    path: ['body'],
  });

export const MarkConversationReadRequestSchema = z
  .object({
    upToMessageId: IdSchema,
  })
  .strict();

export const ConversationsQuerySchema = CursorPaginationQuerySchema.extend({
  archived: z.stringbool().optional(),
}).strict();

export const ReportConversationRequestSchema = z
  .object({
    reason: z.string().min(1).max(500),
    messageId: IdSchema.optional(),
  })
  .strict();

registry.registerPath({
  method: 'get',
  path: apiPath('/conversations'),
  summary: "List the current user's conversations",
  tags: ['chat'],
  security: AUTH_SECURITY,
  request: {
    query: ConversationsQuerySchema,
  },
  responses: {
    '200': {
      description: 'A page of conversations',
      content: { 'application/json': { schema: paginatedResponseSchema(ConversationSchema) } },
    },
    ...errorResponses([400, 401]),
  },
});

registry.registerPath({
  method: 'get',
  path: apiPath('/conversations/unread-count'),
  summary: "Get the current user's unread message count across conversations",
  tags: ['chat'],
  security: AUTH_SECURITY,
  responses: {
    '200': {
      description: 'The unread message count',
      content: { 'application/json': { schema: ConversationsUnreadCountResponseSchema } },
    },
    ...errorResponses([401]),
  },
});

registry.registerPath({
  method: 'get',
  path: apiPath('/conversations/{id}'),
  summary: 'Get a conversation',
  tags: ['chat'],
  security: AUTH_SECURITY,
  request: {
    params: z.object({ id: IdSchema }).strict(),
  },
  responses: {
    '200': {
      description: 'The conversation',
      content: { 'application/json': { schema: ConversationSchema } },
    },
    ...errorResponses([401, 404]),
  },
});

registry.registerPath({
  method: 'get',
  path: apiPath('/conversations/{id}/messages'),
  summary: 'List the messages of a conversation, newest first',
  tags: ['chat'],
  security: AUTH_SECURITY,
  request: {
    params: z.object({ id: IdSchema }).strict(),
    query: CursorPaginationQuerySchema,
  },
  responses: {
    '200': {
      description: 'A page of messages',
      content: { 'application/json': { schema: paginatedResponseSchema(MessageSchema) } },
    },
    ...errorResponses([400, 401, 404]),
  },
});

registry.registerPath({
  method: 'post',
  path: apiPath('/conversations/{id}/messages'),
  summary: 'Send a message in a conversation',
  tags: ['chat'],
  security: AUTH_SECURITY,
  request: {
    params: z.object({ id: IdSchema }).strict(),
    body: { content: { 'application/json': { schema: SendMessageRequestSchema } } },
  },
  responses: {
    '201': {
      description: 'Message sent',
      content: { 'application/json': { schema: MessageSchema } },
    },
    ...errorResponses([400, 401, 404, 422, 429]),
  },
});

registry.registerPath({
  method: 'delete',
  path: apiPath('/conversations/{id}/messages/{messageId}'),
  summary: "Soft-delete the caller's own message within the edit window",
  tags: ['chat'],
  security: AUTH_SECURITY,
  request: {
    params: z.object({ id: IdSchema, messageId: IdSchema }).strict(),
  },
  responses: {
    '200': {
      description: 'Message deleted',
      content: { 'application/json': { schema: MessageSchema } },
    },
    ...errorResponses([401, 403, 404, 409]),
  },
});

registry.registerPath({
  method: 'get',
  path: apiPath('/conversations/{id}/messages/{messageId}/attachments/{attachmentId}/download'),
  summary: 'Get a short-lived presigned download URL for a message attachment',
  tags: ['chat'],
  security: AUTH_SECURITY,
  request: {
    params: z.object({ id: IdSchema, messageId: IdSchema, attachmentId: IdSchema }).strict(),
  },
  responses: {
    '200': {
      description: 'Presigned download URL issued',
      content: { 'application/json': { schema: UploadDownloadResponseSchema } },
    },
    ...errorResponses([401, 404, 409]),
  },
});

registry.registerPath({
  method: 'post',
  path: apiPath('/conversations/{id}/read'),
  summary: 'Mark a conversation as read up to a message',
  tags: ['chat'],
  security: AUTH_SECURITY,
  request: {
    params: z.object({ id: IdSchema }).strict(),
    body: { content: { 'application/json': { schema: MarkConversationReadRequestSchema } } },
  },
  responses: {
    '200': {
      description: 'Conversation marked as read',
      content: { 'application/json': { schema: ConversationSchema } },
    },
    ...errorResponses([400, 401, 404]),
  },
});

registry.registerPath({
  method: 'post',
  path: apiPath('/conversations/{id}/archive'),
  summary: 'Archive a conversation for the current user',
  tags: ['chat'],
  security: AUTH_SECURITY,
  request: {
    params: z.object({ id: IdSchema }).strict(),
  },
  responses: {
    '200': {
      description: 'Conversation archived',
      content: { 'application/json': { schema: ConversationSchema } },
    },
    ...errorResponses([401, 404]),
  },
});

registry.registerPath({
  method: 'post',
  path: apiPath('/conversations/{id}/unarchive'),
  summary: 'Unarchive a conversation for the current user',
  tags: ['chat'],
  security: AUTH_SECURITY,
  request: {
    params: z.object({ id: IdSchema }).strict(),
  },
  responses: {
    '200': {
      description: 'Conversation unarchived',
      content: { 'application/json': { schema: ConversationSchema } },
    },
    ...errorResponses([401, 404]),
  },
});

registry.registerPath({
  method: 'post',
  path: apiPath('/conversations/{id}/report'),
  summary: 'Report a conversation for abuse',
  tags: ['chat'],
  security: AUTH_SECURITY,
  request: {
    params: z.object({ id: IdSchema }).strict(),
    body: { content: { 'application/json': { schema: ReportConversationRequestSchema } } },
  },
  responses: {
    '204': { description: 'Report recorded' },
    ...errorResponses([400, 401, 404, 429]),
  },
});
