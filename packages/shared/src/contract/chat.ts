import { ATTACHMENT_KINDS, CONVERSATION_TYPES } from '../enums.js';
import {
  CursorPaginationQuerySchema,
  IdSchema,
  IsoDateTimeSchema,
  errorResponses,
  paginatedResponseSchema,
} from './common.js';
import { AUTH_SECURITY, apiPath, registry } from './registry.js';
import { z } from './zod.js';

export const MessageAttachmentSchema = z
  .object({
    id: IdSchema,
    kind: z.enum(ATTACHMENT_KINDS),
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
    readBy: z.array(IdSchema),
    editedAt: IsoDateTimeSchema.nullable(),
    createdAt: IsoDateTimeSchema,
  })
  .strict()
  .openapi('Message');

export const ConversationSchema = z
  .object({
    id: IdSchema,
    type: z.enum(CONVERSATION_TYPES),
    subjectId: IdSchema.nullable(),
    participantIds: z.array(IdSchema).min(1),
    lastMessageAt: IsoDateTimeSchema.nullable(),
    unreadCount: z.int().nonnegative(),
    archivedByMe: z.boolean(),
  })
  .strict()
  .openapi('Conversation');

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
    body: z.string().min(1).max(4000).optional(),
    attachmentIds: z.array(IdSchema).min(1).optional(),
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

export const ArchiveConversationRequestSchema = z
  .object({
    archived: z.boolean().default(true),
  })
  .strict();

registry.registerPath({
  method: 'get',
  path: apiPath('/conversations'),
  summary: "List the current user's conversations",
  tags: ['chat'],
  security: AUTH_SECURITY,
  request: {
    query: CursorPaginationQuerySchema,
  },
  responses: {
    '200': {
      description: 'A page of conversations',
      content: { 'application/json': { schema: paginatedResponseSchema(ConversationSchema) } },
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
    ...errorResponses([401, 403, 404]),
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
    ...errorResponses([401, 403, 404]),
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
    ...errorResponses([400, 401, 403, 404, 422, 429]),
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
    ...errorResponses([400, 401, 403, 404]),
  },
});

registry.registerPath({
  method: 'post',
  path: apiPath('/conversations/{id}/archive'),
  summary: 'Archive or unarchive a conversation for the current user',
  tags: ['chat'],
  security: AUTH_SECURITY,
  request: {
    params: z.object({ id: IdSchema }).strict(),
    body: { content: { 'application/json': { schema: ArchiveConversationRequestSchema } } },
  },
  responses: {
    '200': {
      description: 'Conversation archive state updated',
      content: { 'application/json': { schema: ConversationSchema } },
    },
    ...errorResponses([400, 401, 403, 404]),
  },
});
