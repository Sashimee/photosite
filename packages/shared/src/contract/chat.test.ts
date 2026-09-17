import { describe, expect, it } from 'vitest';
import {
  ConversationSchema,
  ConversationsQuerySchema,
  MarkConversationReadRequestSchema,
  MessageSchema,
  ReportConversationRequestSchema,
  SendMessageRequestSchema,
} from './chat.js';

const validConversation = {
  id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  type: 'booking',
  subjectId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  participants: [{ userId: '3fa85f64-5717-4562-b3fc-2c963f66afa6', lastReadAt: null }],
  lastMessageAt: '2026-09-16T12:00:00.000Z',
  lastMessagePreview: 'Hello there',
  unreadCount: 2,
  archivedByMe: false,
};

const validMessage = {
  id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  conversationId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  senderId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  body: 'Hello there',
  attachments: [],
  editedAt: null,
  deletedAt: null,
  createdAt: '2026-09-16T12:00:00.000Z',
};

describe('ConversationSchema', () => {
  it('accepts a well-formed conversation', () => {
    expect(ConversationSchema.safeParse(validConversation).success).toBe(true);
  });

  it('rejects an unknown conversation type', () => {
    expect(ConversationSchema.safeParse({ ...validConversation, type: 'group' }).success).toBe(
      false,
    );
  });

  it('rejects a legacy participantIds field', () => {
    expect(
      ConversationSchema.safeParse({
        ...validConversation,
        participantIds: ['3fa85f64-5717-4562-b3fc-2c963f66afa6'],
      }).success,
    ).toBe(false);
  });

  it('requires at least one participant', () => {
    expect(ConversationSchema.safeParse({ ...validConversation, participants: [] }).success).toBe(
      false,
    );
  });
});

describe('MessageSchema', () => {
  it('accepts a well-formed message', () => {
    expect(MessageSchema.safeParse(validMessage).success).toBe(true);
  });

  it('accepts a message with only attachments and no body', () => {
    expect(
      MessageSchema.safeParse({
        ...validMessage,
        body: null,
        attachments: [{ id: validMessage.id, kind: 'image' }],
      }).success,
    ).toBe(true);
  });

  it('accepts a deleted message with a blanked body', () => {
    expect(
      MessageSchema.safeParse({
        ...validMessage,
        body: null,
        deletedAt: '2026-09-16T12:05:00.000Z',
      }).success,
    ).toBe(true);
  });

  it('rejects an attachment with an unknown kind', () => {
    expect(
      MessageSchema.safeParse({
        ...validMessage,
        attachments: [{ id: validMessage.id, kind: 'video' }],
      }).success,
    ).toBe(false);
  });

  it('rejects a body over 4000 characters', () => {
    expect(MessageSchema.safeParse({ ...validMessage, body: 'a'.repeat(4001) }).success).toBe(
      false,
    );
  });
});

describe('SendMessageRequestSchema', () => {
  it('accepts a body only', () => {
    expect(SendMessageRequestSchema.safeParse({ body: 'Hello' }).success).toBe(true);
  });

  it('accepts attachment ids only', () => {
    expect(
      SendMessageRequestSchema.safeParse({
        attachmentIds: ['3fa85f64-5717-4562-b3fc-2c963f66afa6'],
      }).success,
    ).toBe(true);
  });

  it('rejects an empty request', () => {
    expect(SendMessageRequestSchema.safeParse({}).success).toBe(false);
  });

  it('rejects an empty body string with no attachments', () => {
    expect(SendMessageRequestSchema.safeParse({ body: '' }).success).toBe(false);
  });

  it('rejects more than 10 attachment ids', () => {
    const attachmentIds = Array.from({ length: 11 }, () => '3fa85f64-5717-4562-b3fc-2c963f66afa6');
    expect(SendMessageRequestSchema.safeParse({ attachmentIds }).success).toBe(false);
  });

  it('trims surrounding whitespace from the body', () => {
    const result = SendMessageRequestSchema.safeParse({ body: '  Hello  ' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.body).toBe('Hello');
  });

  it('rejects a body that is only whitespace', () => {
    expect(SendMessageRequestSchema.safeParse({ body: '   ' }).success).toBe(false);
  });

  it('accepts newlines and tabs in the body', () => {
    expect(SendMessageRequestSchema.safeParse({ body: 'line one\nline two\tend' }).success).toBe(
      true,
    );
  });

  it('rejects a NUL byte in the body', () => {
    expect(SendMessageRequestSchema.safeParse({ body: 'hello\u0000world' }).success).toBe(false);
  });

  it('rejects an ANSI escape sequence in the body', () => {
    expect(SendMessageRequestSchema.safeParse({ body: 'hello\u001b[31mworld' }).success).toBe(
      false,
    );
  });

  it('rejects a carriage return in the body', () => {
    expect(SendMessageRequestSchema.safeParse({ body: 'hello\rworld' }).success).toBe(false);
  });
});

describe('MarkConversationReadRequestSchema', () => {
  it('requires an upToMessageId', () => {
    expect(MarkConversationReadRequestSchema.safeParse({}).success).toBe(false);
    expect(
      MarkConversationReadRequestSchema.safeParse({
        upToMessageId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
      }).success,
    ).toBe(true);
  });
});

describe('ConversationsQuerySchema', () => {
  it('leaves archived unset by default', () => {
    const result = ConversationsQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.archived).toBeUndefined();
  });

  it('coerces an archived=true query string', () => {
    const result = ConversationsQuerySchema.safeParse({ archived: 'true' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.archived).toBe(true);
  });
});

describe('ReportConversationRequestSchema', () => {
  it('requires a non-empty reason', () => {
    expect(ReportConversationRequestSchema.safeParse({ reason: '' }).success).toBe(false);
    expect(ReportConversationRequestSchema.safeParse({ reason: 'Spam' }).success).toBe(true);
  });

  it('accepts an optional messageId', () => {
    expect(
      ReportConversationRequestSchema.safeParse({
        reason: 'Spam',
        messageId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
      }).success,
    ).toBe(true);
  });
});
