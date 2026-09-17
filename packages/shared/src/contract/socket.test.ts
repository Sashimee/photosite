import { describe, expect, it } from 'vitest';
import {
  ClientConversationJoinEventSchema,
  ClientMessageSendEventSchema,
  ClientReadEventSchema,
  ClientTypingEventSchema,
  ServerConversationUpdatedEventSchema,
  ServerMessageDeletedEventSchema,
  ServerMessageNewEventSchema,
  ServerReadEventSchema,
  ServerTypingEventSchema,
  SocketHandshakeAuthSchema,
} from './socket.js';

const id = '3fa85f64-5717-4562-b3fc-2c963f66afa6';

describe('ClientConversationJoinEventSchema', () => {
  it('requires a conversationId', () => {
    expect(ClientConversationJoinEventSchema.safeParse({ conversationId: id }).success).toBe(true);
    expect(ClientConversationJoinEventSchema.safeParse({}).success).toBe(false);
  });
});

describe('SocketHandshakeAuthSchema', () => {
  it('accepts an empty payload for cookie-based sessions', () => {
    expect(SocketHandshakeAuthSchema.safeParse({}).success).toBe(true);
  });

  it('accepts a bearer token for mobile sessions', () => {
    expect(SocketHandshakeAuthSchema.safeParse({ token: 'sess_abc123' }).success).toBe(true);
  });

  it('rejects unknown keys', () => {
    expect(SocketHandshakeAuthSchema.safeParse({ token: 'x', deviceId: 'y' }).success).toBe(false);
  });
});

describe('ClientMessageSendEventSchema', () => {
  it('accepts a conversation id with a body', () => {
    expect(
      ClientMessageSendEventSchema.safeParse({ conversationId: id, body: 'Hello' }).success,
    ).toBe(true);
  });

  it('accepts attachments without a body', () => {
    expect(
      ClientMessageSendEventSchema.safeParse({ conversationId: id, attachmentIds: [id] }).success,
    ).toBe(true);
  });

  it('rejects an event with neither body nor attachments', () => {
    expect(ClientMessageSendEventSchema.safeParse({ conversationId: id }).success).toBe(false);
  });

  it('rejects a non-uuid conversationId', () => {
    expect(
      ClientMessageSendEventSchema.safeParse({ conversationId: 'not-a-uuid', body: 'Hello' })
        .success,
    ).toBe(false);
  });
});

describe('ClientTypingEventSchema', () => {
  it('requires isTyping as a boolean', () => {
    expect(ClientTypingEventSchema.safeParse({ conversationId: id, isTyping: true }).success).toBe(
      true,
    );
    expect(ClientTypingEventSchema.safeParse({ conversationId: id, isTyping: 'yes' }).success).toBe(
      false,
    );
  });
});

describe('ClientReadEventSchema', () => {
  it('requires an upToMessageId', () => {
    expect(ClientReadEventSchema.safeParse({ conversationId: id, upToMessageId: id }).success).toBe(
      true,
    );
  });
});

describe('server events', () => {
  it('ServerTypingEventSchema requires a userId', () => {
    expect(
      ServerTypingEventSchema.safeParse({ conversationId: id, userId: id, isTyping: true }).success,
    ).toBe(true);
  });

  it('ServerReadEventSchema requires a userId and upToMessageId', () => {
    expect(
      ServerReadEventSchema.safeParse({ conversationId: id, userId: id, upToMessageId: id })
        .success,
    ).toBe(true);
  });

  it('ServerMessageNewEventSchema wraps a message', () => {
    const message = {
      id,
      conversationId: id,
      senderId: id,
      body: 'Hello',
      attachments: [],
      editedAt: null,
      deletedAt: null,
      createdAt: '2026-09-16T12:00:00.000Z',
    };
    expect(ServerMessageNewEventSchema.safeParse({ message }).success).toBe(true);
  });

  it('ServerMessageDeletedEventSchema wraps a blanked message', () => {
    const message = {
      id,
      conversationId: id,
      senderId: id,
      body: null,
      attachments: [],
      editedAt: null,
      deletedAt: '2026-09-16T12:05:00.000Z',
      createdAt: '2026-09-16T12:00:00.000Z',
    };
    expect(ServerMessageDeletedEventSchema.safeParse({ message }).success).toBe(true);
  });

  it('ServerConversationUpdatedEventSchema wraps a conversation', () => {
    const conversation = {
      id,
      type: 'direct',
      subjectId: null,
      participants: [{ userId: id, lastReadAt: null }],
      lastMessageAt: null,
      lastMessagePreview: null,
      unreadCount: 0,
      archivedByMe: false,
    };
    expect(ServerConversationUpdatedEventSchema.safeParse({ conversation }).success).toBe(true);
  });
});
