import { describe, expect, it } from 'vitest';
import {
  ArchiveConversationRequestSchema,
  ConversationSchema,
  MarkConversationReadRequestSchema,
  MessageSchema,
  SendMessageRequestSchema,
} from './chat.js';

const validConversation = {
  id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  type: 'booking',
  subjectId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  participantIds: ['3fa85f64-5717-4562-b3fc-2c963f66afa6'],
  lastMessageAt: '2026-09-16T12:00:00.000Z',
  unreadCount: 2,
  archivedByMe: false,
};

const validMessage = {
  id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  conversationId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  senderId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  body: 'Hello there',
  attachments: [],
  readBy: [],
  editedAt: null,
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

  it('rejects an archivedBy field carrying other users ids', () => {
    expect(
      ConversationSchema.safeParse({
        ...validConversation,
        archivedBy: ['3fa85f64-5717-4562-b3fc-2c963f66afa6'],
      }).success,
    ).toBe(false);
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

describe('ArchiveConversationRequestSchema', () => {
  it('defaults archived to true', () => {
    const result = ArchiveConversationRequestSchema.parse({});
    expect(result.archived).toBe(true);
  });

  it('accepts an explicit false to unarchive', () => {
    expect(ArchiveConversationRequestSchema.safeParse({ archived: false }).success).toBe(true);
  });
});
