'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import type { components } from '@photoo/api-client';
import {
  CLIENT_SOCKET_EVENTS,
  MessageBodySchema,
  SERVER_SOCKET_EVENTS,
  atLeastOneOfBodyOrAttachments,
  type SocketAck,
} from '@photoo/shared';

import { api } from './api';
import { useChatSocket } from './chat-socket';
import type { ApiErrorLike } from './request-errors';

type Message = components['schemas']['Message'];
type Conversation = components['schemas']['Conversation'];

const READ_DEBOUNCE_MS = 500;
const TYPING_THROTTLE_MS = 2000;
const TYPING_STOP_DELAY_MS = 3000;
const ACK_TIMEOUT_MS = 8000;

export type PendingMessageStatus = 'sending' | 'failed';

// A pending attachment carries the metadata the composer already has from
// the file the user picked (lib/chat-attachments.ts), so the optimistic
// bubble can render a chip before the server has a MessageAttachment (which
// has no file name at all, only mimeType/sizeBytes) to hand back.
export interface PendingAttachment {
  uploadId: string;
  mimeType: string;
  sizeBytes: number;
}

export interface PendingMessage {
  localId: string;
  body?: string | undefined;
  attachments?: PendingAttachment[] | undefined;
  status: PendingMessageStatus;
  createdAt: string;
  error?: ApiErrorLike | undefined;
}

export type ConnectionState = 'connecting' | 'connected' | 'disconnected';

export interface SendMessageInput {
  body?: string | undefined;
  attachments?: PendingAttachment[] | undefined;
}

export type SendMessageResult = { ok: true } | { ok: false; error: ApiErrorLike };

export interface UseConversationOptions {
  conversationId: string;
  initialMessages: Message[];
  initialNextCursor: string | null;
  initialConversation: Conversation;
}

export interface UseConversationResult {
  conversation: Conversation;
  messages: Message[];
  pending: PendingMessage[];
  connectionState: ConnectionState;
  hasOlder: boolean;
  loadingOlder: boolean;
  loadOlder: () => Promise<void>;
  sendMessage: (input: SendMessageInput) => Promise<SendMessageResult>;
  retryMessage: (localId: string) => Promise<void>;
  typingUserIds: string[];
  notifyTyping: (isTyping: boolean) => void;
}

function sortMessages(list: Message[]): Message[] {
  return [...list].sort((a, b) => {
    const diff = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    return diff !== 0 ? diff : a.id.localeCompare(b.id);
  });
}

export function useConversation(options: UseConversationOptions): UseConversationResult {
  const { conversationId, initialMessages, initialNextCursor, initialConversation } = options;
  const { socket, connected } = useChatSocket();

  const messagesMapRef = useRef<Map<string, Message>>(new Map());
  const [messages, setMessages] = useState<Message[]>(() => {
    const map = new Map(initialMessages.map((message) => [message.id, message]));
    messagesMapRef.current = map;
    return sortMessages([...map.values()]);
  });
  const [pending, setPending] = useState<PendingMessage[]>([]);
  const [conversation, setConversation] = useState<Conversation>(initialConversation);
  const [nextCursor, setNextCursor] = useState<string | null>(initialNextCursor);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [typingUserIds, setTypingUserIds] = useState<string[]>([]);
  const [hasConnectedOnce, setHasConnectedOnce] = useState(connected);

  const joinedOnceRef = useRef(false);
  const typingSentAtRef = useRef(0);
  const typingActiveRef = useRef(false);
  const typingStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const readTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const commitMessages = useCallback(() => {
    setMessages(sortMessages([...messagesMapRef.current.values()]));
  }, []);

  const upsertMessage = useCallback(
    (message: Message) => {
      messagesMapRef.current.set(message.id, message);
      commitMessages();
    },
    [commitMessages],
  );

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
    if (!connected) {
      return;
    }
    let cancelled = false;

    async function join() {
      if (joinedOnceRef.current) {
        const { data } = await api.GET('/v1/conversations/{id}/messages', {
          params: { path: { id: conversationId }, query: {} },
          cache: 'no-store',
        });
        if (!cancelled && data) {
          messagesMapRef.current = new Map(data.items.map((message) => [message.id, message]));
          commitMessages();
          setNextCursor(data.nextCursor);
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
    };
  }, [connected, conversationId, socket, commitMessages]);

  useEffect(() => {
    function handleMessageEvent(payload: { message: Message }) {
      if (payload.message.conversationId !== conversationId) {
        return;
      }
      upsertMessage(payload.message);
    }
    socket.on(SERVER_SOCKET_EVENTS.MESSAGE_NEW, handleMessageEvent);
    socket.on(SERVER_SOCKET_EVENTS.MESSAGE_DELETED, handleMessageEvent);
    return () => {
      socket.off(SERVER_SOCKET_EVENTS.MESSAGE_NEW, handleMessageEvent);
      socket.off(SERVER_SOCKET_EVENTS.MESSAGE_DELETED, handleMessageEvent);
    };
  }, [socket, conversationId, upsertMessage]);

  useEffect(() => {
    function handleConversationUpdated(payload: { conversation: Conversation }) {
      if (payload.conversation.id !== conversationId) {
        return;
      }
      setConversation(payload.conversation);
    }
    socket.on(SERVER_SOCKET_EVENTS.CONVERSATION_UPDATED, handleConversationUpdated);
    return () => {
      socket.off(SERVER_SOCKET_EVENTS.CONVERSATION_UPDATED, handleConversationUpdated);
    };
  }, [socket, conversationId]);

  useEffect(() => {
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
    socket.on(SERVER_SOCKET_EVENTS.TYPING, handleTyping);
    return () => {
      socket.off(SERVER_SOCKET_EVENTS.TYPING, handleTyping);
    };
  }, [socket, conversationId]);

  const emitRead = useCallback(
    (upToMessageId: string) => {
      socket.emit(CLIENT_SOCKET_EVENTS.READ, { conversationId, upToMessageId });
    },
    [socket, conversationId],
  );

  // The newest message only counts as read once the tab is both visible and
  // focused (Page Visibility API), debounced so rapid incoming messages
  // don't fire a `read` event each; a hidden or blurred tab never marks
  // anything read, however long it stays open.
  useEffect(() => {
    const newest = messages.at(-1);
    if (!newest || !connected) {
      return;
    }
    const newestMessageId = newest.id;

    function isVisible(): boolean {
      return document.visibilityState === 'visible' && document.hasFocus();
    }

    function scheduleRead() {
      if (!isVisible()) {
        return;
      }
      if (readTimerRef.current) {
        clearTimeout(readTimerRef.current);
      }
      readTimerRef.current = setTimeout(() => {
        emitRead(newestMessageId);
      }, READ_DEBOUNCE_MS);
    }

    scheduleRead();
    document.addEventListener('visibilitychange', scheduleRead);
    window.addEventListener('focus', scheduleRead);
    return () => {
      document.removeEventListener('visibilitychange', scheduleRead);
      window.removeEventListener('focus', scheduleRead);
      if (readTimerRef.current) {
        clearTimeout(readTimerRef.current);
        readTimerRef.current = null;
      }
    };
  }, [messages, connected, emitRead]);

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
    try {
      const { data } = await api.GET('/v1/conversations/{id}/messages', {
        params: { path: { id: conversationId }, query: { cursor: nextCursor } },
        cache: 'no-store',
      });
      if (data) {
        for (const message of data.items) {
          messagesMapRef.current.set(message.id, message);
        }
        commitMessages();
        setNextCursor(data.nextCursor);
      }
    } finally {
      setLoadingOlder(false);
    }
  }, [nextCursor, loadingOlder, conversationId, commitMessages]);

  const dispatchSend = useCallback(
    async (
      payload: SendMessageInput,
    ): Promise<{ ok: true; message: Message } | { ok: false; error: ApiErrorLike }> => {
      const body = payload.body;
      const attachmentIds = payload.attachments?.length
        ? payload.attachments.map((attachment) => attachment.uploadId)
        : undefined;

      if (socket.connected) {
        try {
          const ack = (await socket
            .timeout(ACK_TIMEOUT_MS)
            .emitWithAck(CLIENT_SOCKET_EVENTS.MESSAGE_SEND, {
              conversationId,
              body,
              attachmentIds,
            })) as SocketAck<{ message: Message }>;
          if (ack.ok) {
            return { ok: true, message: ack.data.message };
          }
          return { ok: false, error: ack.error };
        } catch {
          return { ok: false, error: { code: 'ERROR', message: 'The connection timed out' } };
        }
      }

      const { data, error } = await api.POST('/v1/conversations/{id}/messages', {
        params: { path: { id: conversationId } },
        body: {
          ...(body !== undefined ? { body } : {}),
          ...(attachmentIds !== undefined ? { attachmentIds } : {}),
        },
      });
      if (data) {
        return { ok: true, message: data };
      }
      return { ok: false, error };
    },
    [socket, conversationId],
  );

  const sendMessage = useCallback(
    async (input: SendMessageInput): Promise<SendMessageResult> => {
      // `??` would keep an empty string; an empty body must collapse to
      // undefined the same as an absent one.
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
      const body = input.body?.trim() || undefined;
      const attachments = input.attachments?.length ? input.attachments : undefined;
      const attachmentIds = attachments?.map((attachment) => attachment.uploadId);

      if (!atLeastOneOfBodyOrAttachments({ body, attachmentIds })) {
        return { ok: false, error: { code: 'BAD_REQUEST' } };
      }
      if (body) {
        const parsed = MessageBodySchema.safeParse(body);
        if (!parsed.success) {
          return {
            ok: false,
            error: { code: 'BAD_REQUEST', message: parsed.error.issues[0]?.message },
          };
        }
      }

      const localId = `pending-${crypto.randomUUID()}`;
      setPending((previous) => [
        ...previous,
        { localId, body, attachments, status: 'sending', createdAt: new Date().toISOString() },
      ]);
      notifyTyping(false);

      const result = await dispatchSend({ body, attachments });
      if (result.ok) {
        upsertMessage(result.message);
        setPending((previous) => previous.filter((entry) => entry.localId !== localId));
        return { ok: true };
      }
      setPending((previous) =>
        previous.map((entry) =>
          entry.localId === localId ? { ...entry, status: 'failed', error: result.error } : entry,
        ),
      );
      return { ok: false, error: result.error };
    },
    [dispatchSend, notifyTyping, upsertMessage],
  );

  const retryMessage = useCallback(
    async (localId: string) => {
      const entry = pending.find((item) => item.localId === localId);
      if (!entry) {
        return;
      }
      setPending((previous) =>
        previous.map((item) =>
          item.localId === localId ? { ...item, status: 'sending', error: undefined } : item,
        ),
      );
      const result = await dispatchSend({ body: entry.body, attachments: entry.attachments });
      if (result.ok) {
        upsertMessage(result.message);
        setPending((previous) => previous.filter((item) => item.localId !== localId));
        return;
      }
      setPending((previous) =>
        previous.map((item) =>
          item.localId === localId ? { ...item, status: 'failed', error: result.error } : item,
        ),
      );
    },
    [pending, dispatchSend, upsertMessage],
  );

  return {
    conversation,
    messages,
    pending,
    connectionState,
    hasOlder: nextCursor !== null,
    loadingOlder,
    loadOlder,
    sendMessage,
    retryMessage,
    typingUserIds,
    notifyTyping,
  };
}
