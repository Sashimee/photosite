import { useCallback, useEffect, useRef, useState } from 'react';

import type { components } from '@photoo/api-client';
import {
  CLIENT_SOCKET_EVENTS,
  MessageBodySchema,
  SERVER_SOCKET_EVENTS,
  type SocketAck,
} from '@photoo/shared';

import { api } from './api';
import type { ApiErrorLike } from './auth-errors';
import type { PendingAttachment } from './chat-attachments';
import { useChatSocket } from './chat-socket';

type Message = components['schemas']['Message'];
type Conversation = components['schemas']['Conversation'];

const TYPING_THROTTLE_MS = 2000;
const TYPING_STOP_DELAY_MS = 3000;
const ACK_TIMEOUT_MS = 8000;

export type LoadState = 'loading' | 'ready' | 'notFound' | 'failed';
export type ConnectionState = 'connecting' | 'connected' | 'disconnected';

export interface PendingMessage {
  localId: string;
  body: string;
  attachments: PendingAttachment[];
  status: 'sending' | 'failed';
  createdAt: string;
  error?: ApiErrorLike | undefined;
}

export interface SendMessageInput {
  body: string;
  attachments: PendingAttachment[];
}

export type SendMessageResult =
  | { ok: true }
  | { ok: false; kind: 'invalid' }
  | { ok: false; kind: 'failed'; error: ApiErrorLike };

type DispatchResult = { ok: true; message: Message } | { ok: false; error: ApiErrorLike };

let pendingCounter = 0;

function sortMessages(list: Iterable<Message>): Message[] {
  return [...list].sort((a, b) => {
    const diff = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    return diff !== 0 ? diff : a.id.localeCompare(b.id);
  });
}

export function useConversation(conversationId: string, isVisible: boolean) {
  const { socket, connected } = useChatSocket();

  const messagesRef = useRef(new Map<string, Message>());
  const [messages, setMessages] = useState<Message[]>([]);
  const [pending, setPending] = useState<PendingMessage[]>([]);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderFailed, setOlderFailed] = useState(false);
  const [typingUserIds, setTypingUserIds] = useState<string[]>([]);
  const [hasConnectedOnce, setHasConnectedOnce] = useState(connected);

  const joinedOnceRef = useRef(false);
  const retryingRef = useRef(new Set<string>());
  const typingSentAtRef = useRef(0);
  const typingActiveRef = useRef(false);
  const typingStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastReadIdRef = useRef<string | null>(null);

  const commitMessages = useCallback(() => {
    setMessages(sortMessages(messagesRef.current.values()));
  }, []);

  const upsertMessage = useCallback(
    (message: Message) => {
      messagesRef.current.set(message.id, message);
      commitMessages();
    },
    [commitMessages],
  );

  const load = useCallback(async () => {
    setLoadState('loading');
    try {
      const [conversationResult, messagesResult] = await Promise.all([
        api.GET('/v1/conversations/{id}', { params: { path: { id: conversationId } } }),
        api.GET('/v1/conversations/{id}/messages', {
          params: { path: { id: conversationId }, query: {} },
        }),
      ]);
      if (conversationResult.data && messagesResult.data) {
        setConversation(conversationResult.data);
        messagesRef.current = new Map(messagesResult.data.items.map((item) => [item.id, item]));
        commitMessages();
        setNextCursor(messagesResult.data.nextCursor);
        setLoadState('ready');
        return;
      }
      const notFound =
        conversationResult.response.status === 404 || messagesResult.response.status === 404;
      setLoadState(notFound ? 'notFound' : 'failed');
    } catch {
      setLoadState('failed');
    }
  }, [conversationId, commitMessages]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (connected) {
      setHasConnectedOnce(true);
    }
  }, [connected]);

  const connectionState: ConnectionState = connected
    ? 'connected'
    : hasConnectedOnce
      ? 'disconnected'
      : 'connecting';

  useEffect(() => {
    if (!connected || loadState !== 'ready') {
      return;
    }
    let cancelled = false;

    async function join() {
      if (joinedOnceRef.current) {
        try {
          const { data } = await api.GET('/v1/conversations/{id}/messages', {
            params: { path: { id: conversationId }, query: {} },
          });
          if (!cancelled && data) {
            messagesRef.current = new Map(data.items.map((item) => [item.id, item]));
            commitMessages();
            setNextCursor(data.nextCursor);
          }
        } catch {
          return;
        }
      }
      await socket
        .timeout(ACK_TIMEOUT_MS)
        .emitWithAck(CLIENT_SOCKET_EVENTS.CONVERSATION_JOIN, { conversationId })
        .catch(() => undefined);
      if (!cancelled) {
        joinedOnceRef.current = true;
      }
    }

    void join();
    return () => {
      cancelled = true;
      lastReadIdRef.current = null;
    };
  }, [connected, loadState, conversationId, socket, commitMessages]);

  useEffect(() => {
    function handleMessageEvent(payload: { message: Message }) {
      if (payload.message.conversationId === conversationId) {
        upsertMessage(payload.message);
      }
    }
    function handleConversationUpdated(payload: { conversation: Conversation }) {
      if (payload.conversation.id === conversationId) {
        setConversation(payload.conversation);
      }
    }
    function handleTyping(payload: { conversationId: string; userId: string; isTyping: boolean }) {
      if (payload.conversationId !== conversationId) {
        return;
      }
      setTypingUserIds((previous) => {
        const next = new Set(previous);
        if (payload.isTyping) {
          next.add(payload.userId);
        } else {
          next.delete(payload.userId);
        }
        return [...next];
      });
    }
    socket.on(SERVER_SOCKET_EVENTS.MESSAGE_NEW, handleMessageEvent);
    socket.on(SERVER_SOCKET_EVENTS.MESSAGE_DELETED, handleMessageEvent);
    socket.on(SERVER_SOCKET_EVENTS.CONVERSATION_UPDATED, handleConversationUpdated);
    socket.on(SERVER_SOCKET_EVENTS.TYPING, handleTyping);
    return () => {
      socket.off(SERVER_SOCKET_EVENTS.MESSAGE_NEW, handleMessageEvent);
      socket.off(SERVER_SOCKET_EVENTS.MESSAGE_DELETED, handleMessageEvent);
      socket.off(SERVER_SOCKET_EVENTS.CONVERSATION_UPDATED, handleConversationUpdated);
      socket.off(SERVER_SOCKET_EVENTS.TYPING, handleTyping);
    };
  }, [socket, conversationId, upsertMessage]);

  const newestId = messages.at(-1)?.id;
  useEffect(() => {
    if (!newestId || !connected || !isVisible || lastReadIdRef.current === newestId) {
      return;
    }
    lastReadIdRef.current = newestId;
    socket.emit(CLIENT_SOCKET_EVENTS.READ, { conversationId, upToMessageId: newestId });
  }, [newestId, connected, isVisible, socket, conversationId]);

  useEffect(
    () => () => {
      if (typingStopTimerRef.current) {
        clearTimeout(typingStopTimerRef.current);
      }
    },
    [],
  );

  const notifyTyping = useCallback(
    (isTyping: boolean) => {
      if (!socket.connected) {
        return;
      }
      if (typingStopTimerRef.current) {
        clearTimeout(typingStopTimerRef.current);
        typingStopTimerRef.current = null;
      }
      if (isTyping) {
        const now = Date.now();
        if (!typingActiveRef.current || now - typingSentAtRef.current >= TYPING_THROTTLE_MS) {
          typingActiveRef.current = true;
          typingSentAtRef.current = now;
          socket.emit(CLIENT_SOCKET_EVENTS.TYPING, { conversationId, isTyping: true });
        }
        typingStopTimerRef.current = setTimeout(() => {
          typingActiveRef.current = false;
          socket.emit(CLIENT_SOCKET_EVENTS.TYPING, { conversationId, isTyping: false });
        }, TYPING_STOP_DELAY_MS);
      } else if (typingActiveRef.current) {
        typingActiveRef.current = false;
        typingSentAtRef.current = 0;
        socket.emit(CLIENT_SOCKET_EVENTS.TYPING, { conversationId, isTyping: false });
      }
    },
    [socket, conversationId],
  );

  const loadOlder = useCallback(async () => {
    if (!nextCursor || loadingOlder) {
      return;
    }
    setLoadingOlder(true);
    setOlderFailed(false);
    try {
      const { data } = await api.GET('/v1/conversations/{id}/messages', {
        params: { path: { id: conversationId }, query: { cursor: nextCursor } },
      });
      if (!data) {
        setOlderFailed(true);
        return;
      }
      for (const message of data.items) {
        messagesRef.current.set(message.id, message);
      }
      commitMessages();
      setNextCursor(data.nextCursor);
    } catch {
      setOlderFailed(true);
    } finally {
      setLoadingOlder(false);
    }
  }, [nextCursor, loadingOlder, conversationId, commitMessages]);

  const dispatchSend = useCallback(
    async (body: string, attachments: PendingAttachment[]): Promise<DispatchResult> => {
      const payload = {
        ...(body ? { body } : {}),
        ...(attachments.length > 0
          ? { attachmentIds: attachments.map((attachment) => attachment.uploadId) }
          : {}),
      };
      if (socket.connected) {
        try {
          const ack = (await socket
            .timeout(ACK_TIMEOUT_MS)
            .emitWithAck(CLIENT_SOCKET_EVENTS.MESSAGE_SEND, {
              conversationId,
              ...payload,
            })) as SocketAck<{ message: Message }>;
          return ack.ok ? { ok: true, message: ack.data.message } : { ok: false, error: ack.error };
        } catch {
          return { ok: false, error: { code: 'ERROR', message: 'The connection timed out' } };
        }
      }
      try {
        const { data, error } = await api.POST('/v1/conversations/{id}/messages', {
          params: { path: { id: conversationId } },
          body: payload,
        });
        return data ? { ok: true, message: data } : { ok: false, error };
      } catch {
        return { ok: false, error: { code: 'ERROR' } };
      }
    },
    [socket, conversationId],
  );

  const settle = useCallback(
    (localId: string, result: DispatchResult) => {
      if (result.ok) {
        upsertMessage(result.message);
        setPending((previous) => previous.filter((entry) => entry.localId !== localId));
        return;
      }
      setPending((previous) =>
        previous.map((entry) =>
          entry.localId === localId ? { ...entry, status: 'failed', error: result.error } : entry,
        ),
      );
    },
    [upsertMessage],
  );

  const sendMessage = useCallback(
    async ({ body: rawBody, attachments }: SendMessageInput): Promise<SendMessageResult> => {
      const parsed = MessageBodySchema.safeParse(rawBody);
      const hasBody = rawBody.trim().length > 0;
      if ((hasBody && !parsed.success) || (!hasBody && attachments.length === 0)) {
        return { ok: false, kind: 'invalid' };
      }
      const body = parsed.success ? parsed.data : '';
      pendingCounter += 1;
      const localId = `pending-${String(Date.now())}-${String(pendingCounter)}`;
      setPending((previous) => [
        ...previous,
        { localId, body, attachments, status: 'sending', createdAt: new Date().toISOString() },
      ]);
      notifyTyping(false);
      const result = await dispatchSend(body, attachments);
      settle(localId, result);
      return result.ok ? { ok: true } : { ok: false, kind: 'failed', error: result.error };
    },
    [dispatchSend, notifyTyping, settle],
  );

  const pendingRef = useRef(pending);
  pendingRef.current = pending;

  const retryMessage = useCallback(
    async (localId: string) => {
      const entry = pendingRef.current.find((item) => item.localId === localId);
      if (!entry || retryingRef.current.has(localId)) {
        return;
      }
      retryingRef.current.add(localId);
      setPending((previous) =>
        previous.map((item) =>
          item.localId === localId ? { ...item, status: 'sending', error: undefined } : item,
        ),
      );
      try {
        settle(localId, await dispatchSend(entry.body, entry.attachments));
      } finally {
        retryingRef.current.delete(localId);
      }
    },
    [dispatchSend, settle],
  );

  return {
    conversation,
    messages,
    pending,
    loadState,
    reload: load,
    connectionState,
    hasOlder: nextCursor !== null,
    loadingOlder,
    olderFailed,
    loadOlder,
    sendMessage,
    retryMessage,
    typingUserIds,
    notifyTyping,
  };
}
