import { useEffect, useState } from 'react';

import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { components } from '@photoo/api-client';
import { CLIENT_SOCKET_EVENTS, SERVER_SOCKET_EVENTS } from '@photoo/shared';

type Message = components['schemas']['Message'];
type Conversation = components['schemas']['Conversation'];

type Ack = { ok: true; data: unknown } | { ok: false; error: { code: string; message?: string } };

class FakeSocket {
  connected = false;
  emit = vi.fn();
  emitWithAckImpl: ((event: string, payload: unknown) => Promise<Ack>) | null = null;
  private listeners = new Map<string, Set<(payload?: unknown) => void>>();

  on(event: string, callback: (payload?: unknown) => void) {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(callback);
  }

  off(event: string, callback: (payload?: unknown) => void) {
    this.listeners.get(event)?.delete(callback);
  }

  trigger(event: string, payload?: unknown) {
    if (event === 'connect') this.connected = true;
    if (event === 'disconnect') this.connected = false;
    for (const callback of [...(this.listeners.get(event) ?? [])]) callback(payload);
  }

  timeout() {
    return {
      emitWithAck: (event: string, payload: unknown) => {
        if (!this.emitWithAckImpl) {
          throw new Error('emitWithAckImpl was not configured for this test');
        }
        return this.emitWithAckImpl(event, payload);
      },
    };
  }

  reset() {
    this.connected = false;
    this.emit.mockClear();
    this.emitWithAckImpl = null;
    this.listeners.clear();
  }
}

const fakeSocket = new FakeSocket();

vi.mock('./chat-socket', () => ({
  useChatSocket: () => {
    const [connected, setConnected] = useState(fakeSocket.connected);
    useEffect(() => {
      function handleConnect() {
        setConnected(true);
      }
      function handleDisconnect() {
        setConnected(false);
      }
      fakeSocket.on('connect', handleConnect);
      fakeSocket.on('disconnect', handleDisconnect);
      setConnected(fakeSocket.connected);
      return () => {
        fakeSocket.off('connect', handleConnect);
        fakeSocket.off('disconnect', handleDisconnect);
      };
    }, []);
    return { socket: fakeSocket, connected };
  },
}));

const apiGetMock = vi.fn();
const apiPostMock = vi.fn();
vi.mock('./api', () => ({ api: { GET: apiGetMock, POST: apiPostMock } }));

async function importHook() {
  return import('./use-conversation');
}

function msg(id: string, createdAt: string, body: string | null = 'hello'): Message {
  return {
    id,
    conversationId: 'conv-1',
    senderId: 'user-1',
    body,
    attachments: [],
    editedAt: null,
    deletedAt: null,
    createdAt,
  };
}

function conversationFixture(): Conversation {
  return {
    id: 'conv-1',
    type: 'quote',
    subjectId: 'quote-1',
    subjectRef: { type: 'quote', quoteId: 'quote-1' },
    participants: [
      {
        userId: 'user-1',
        user: { id: 'user-1', displayName: null, avatarUrl: null },
        lastReadAt: null,
      },
      {
        userId: 'user-2',
        user: { id: 'user-2', displayName: 'Jane Doe', avatarUrl: null },
        lastReadAt: null,
      },
    ],
    lastMessageAt: null,
    lastMessagePreview: null,
    unreadCount: 0,
    archivedByMe: false,
  };
}

function baseOptions(initialMessages: Message[] = []) {
  return {
    conversationId: 'conv-1',
    initialMessages,
    initialNextCursor: null as string | null,
    initialConversation: conversationFixture(),
  };
}

describe('useConversation', () => {
  afterEach(() => {
    fakeSocket.reset();
    apiGetMock.mockReset();
    apiPostMock.mockReset();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('reflects the server-rendered page before any socket connects', async () => {
    const { useConversation } = await importHook();
    const initialMessages = [
      msg('m1', '2026-01-01T00:00:00.000Z'),
      msg('m2', '2026-01-01T00:01:00.000Z'),
    ];

    const { result, unmount } = renderHook(() => useConversation(baseOptions(initialMessages)));

    expect(result.current.messages.map((m) => m.id)).toEqual(['m1', 'm2']);
    expect(result.current.connectionState).toBe('connecting');
    expect(apiGetMock).not.toHaveBeenCalled();
    unmount();
  });

  it('appends an incoming message:new once and does not duplicate an optimistic send', async () => {
    const { useConversation } = await importHook();
    fakeSocket.emitWithAckImpl = (event) => {
      if (event === CLIENT_SOCKET_EVENTS.MESSAGE_SEND) {
        return Promise.resolve({
          ok: true,
          data: { message: msg('m-real', '2026-01-01T00:02:00.000Z', 'hello') },
        });
      }
      return Promise.resolve({ ok: true, data: {} });
    };

    const { result, unmount } = renderHook(() => useConversation(baseOptions()));
    await act(async () => {
      fakeSocket.trigger('connect');
      await Promise.resolve();
    });

    let sendResult;
    await act(async () => {
      sendResult = await result.current.sendMessage({ body: 'hello' });
    });
    expect(sendResult).toEqual({ ok: true });
    expect(result.current.messages.filter((m) => m.id === 'm-real')).toHaveLength(1);
    expect(result.current.pending).toHaveLength(0);

    act(() => {
      fakeSocket.trigger(SERVER_SOCKET_EVENTS.MESSAGE_NEW, {
        message: msg('m-real', '2026-01-01T00:02:00.000Z', 'hello'),
      });
    });
    expect(result.current.messages.filter((m) => m.id === 'm-real')).toHaveLength(1);
    unmount();
  });

  it('shows a pending message on send, and supports retrying a failure', async () => {
    const { useConversation } = await importHook();
    let sendAttempt = 0;
    fakeSocket.emitWithAckImpl = (event) => {
      if (event === CLIENT_SOCKET_EVENTS.CONVERSATION_JOIN) {
        return Promise.resolve({ ok: true, data: {} });
      }
      sendAttempt += 1;
      if (sendAttempt === 1) {
        return Promise.resolve({
          ok: false,
          error: { code: 'UNPROCESSABLE_ENTITY', message: 'bad attachment' },
        });
      }
      return Promise.resolve({
        ok: true,
        data: { message: msg('m-retry', '2026-01-01T00:03:00.000Z', 'hi') },
      });
    };

    const { result, unmount } = renderHook(() => useConversation(baseOptions()));
    await act(async () => {
      fakeSocket.trigger('connect');
      await Promise.resolve();
    });

    let sendResult;
    await act(async () => {
      sendResult = await result.current.sendMessage({ body: 'hi' });
    });
    expect(sendResult).toEqual({
      ok: false,
      error: { code: 'UNPROCESSABLE_ENTITY', message: 'bad attachment' },
    });
    expect(result.current.pending).toHaveLength(1);
    expect(result.current.pending[0]?.status).toBe('failed');

    const localId = result.current.pending[0]?.localId;
    if (!localId) throw new Error('expected a pending message');
    await act(async () => {
      await result.current.retryMessage(localId);
    });

    expect(result.current.pending).toHaveLength(0);
    expect(result.current.messages.some((m) => m.id === 'm-retry')).toBe(true);
    unmount();
  });

  it('falls back to the REST endpoint when the socket is not connected', async () => {
    const { useConversation } = await importHook();
    apiPostMock.mockResolvedValue({ data: msg('m-rest', '2026-01-01T00:04:00.000Z', 'via rest') });

    const { result, unmount } = renderHook(() => useConversation(baseOptions()));

    let sendResult;
    await act(async () => {
      sendResult = await result.current.sendMessage({ body: 'via rest' });
    });

    expect(sendResult).toEqual({ ok: true });
    expect(apiPostMock).toHaveBeenCalledWith(
      '/v1/conversations/{id}/messages',
      expect.objectContaining({ params: { path: { id: 'conv-1' } } }),
    );
    expect(result.current.messages.some((m) => m.id === 'm-rest')).toBe(true);
    unmount();
  });

  it('does not emit read while the document is hidden', async () => {
    vi.useFakeTimers();
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    fakeSocket.emitWithAckImpl = () => Promise.resolve({ ok: true, data: {} });

    const { useConversation } = await importHook();
    const { unmount } = renderHook(() =>
      useConversation(baseOptions([msg('m1', '2026-01-01T00:00:00.000Z')])),
    );

    await act(async () => {
      fakeSocket.trigger('connect');
      await Promise.resolve();
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(fakeSocket.emit).not.toHaveBeenCalledWith(CLIENT_SOCKET_EVENTS.READ, expect.anything());
    unmount();
  });

  it('emits read after the debounce once the document is visible and focused', async () => {
    vi.useFakeTimers();
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    fakeSocket.emitWithAckImpl = () => Promise.resolve({ ok: true, data: {} });

    const { useConversation } = await importHook();
    const { unmount } = renderHook(() =>
      useConversation(baseOptions([msg('m1', '2026-01-01T00:00:00.000Z')])),
    );

    await act(async () => {
      fakeSocket.trigger('connect');
      await Promise.resolve();
    });
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(fakeSocket.emit).toHaveBeenCalledWith(CLIENT_SOCKET_EVENTS.READ, {
      conversationId: 'conv-1',
      upToMessageId: 'm1',
    });
    unmount();
  });

  it('throttles outgoing typing:true and flushes typing:false after the user stops', async () => {
    vi.useFakeTimers();
    fakeSocket.emitWithAckImpl = () => Promise.resolve({ ok: true, data: {} });

    const { useConversation } = await importHook();
    const { result, unmount } = renderHook(() => useConversation(baseOptions()));
    await act(async () => {
      fakeSocket.trigger('connect');
      await Promise.resolve();
    });
    fakeSocket.emit.mockClear();

    act(() => {
      result.current.notifyTyping(true);
    });
    expect(fakeSocket.emit).toHaveBeenCalledTimes(1);
    expect(fakeSocket.emit).toHaveBeenCalledWith(CLIENT_SOCKET_EVENTS.TYPING, {
      conversationId: 'conv-1',
      isTyping: true,
    });

    act(() => {
      result.current.notifyTyping(true);
    });
    expect(fakeSocket.emit).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(2000);
      result.current.notifyTyping(true);
    });
    expect(fakeSocket.emit).toHaveBeenCalledTimes(2);

    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(fakeSocket.emit).toHaveBeenCalledTimes(3);
    expect(fakeSocket.emit).toHaveBeenLastCalledWith(CLIENT_SOCKET_EVENTS.TYPING, {
      conversationId: 'conv-1',
      isTyping: false,
    });
    unmount();
  });

  it('refetches the first page and rejoins after a reconnect', async () => {
    fakeSocket.emitWithAckImpl = () => Promise.resolve({ ok: true, data: {} });
    apiGetMock.mockResolvedValue({
      data: { items: [msg('m-fresh', '2026-01-01T00:05:00.000Z')], nextCursor: null },
    });

    const { useConversation } = await importHook();
    const { result, unmount } = renderHook(() =>
      useConversation(baseOptions([msg('m1', '2026-01-01T00:00:00.000Z')])),
    );

    await act(async () => {
      fakeSocket.trigger('connect');
      await Promise.resolve();
    });
    expect(apiGetMock).not.toHaveBeenCalled();

    act(() => {
      fakeSocket.trigger('disconnect');
    });
    await act(async () => {
      fakeSocket.trigger('connect');
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(apiGetMock).toHaveBeenCalledWith('/v1/conversations/{id}/messages', {
      params: { path: { id: 'conv-1' }, query: {} },
      cache: 'no-store',
    });
    expect(result.current.messages.map((m) => m.id)).toEqual(['m-fresh']);
    unmount();
  });

  it('replaces a message in place when message:deleted arrives', async () => {
    const { useConversation } = await importHook();
    const { result, unmount } = renderHook(() =>
      useConversation(baseOptions([msg('m1', '2026-01-01T00:00:00.000Z', 'hi')])),
    );

    act(() => {
      fakeSocket.trigger(SERVER_SOCKET_EVENTS.MESSAGE_DELETED, {
        message: {
          ...msg('m1', '2026-01-01T00:00:00.000Z'),
          body: null,
          deletedAt: '2026-01-01T00:01:00.000Z',
          attachments: [],
        },
      });
    });

    expect(result.current.messages[0]?.deletedAt).not.toBeNull();
    expect(result.current.messages[0]?.body).toBeNull();
    unmount();
  });
});
