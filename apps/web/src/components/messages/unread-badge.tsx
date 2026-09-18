'use client';

import { SERVER_SOCKET_EVENTS } from '@photoo/shared';
import { useCallback, useEffect, useState } from 'react';

import { api } from '@/lib/api';
import { useSharedChatSocket } from '@/lib/chat-socket';

export function UnreadMessagesBadge() {
  const [count, setCount] = useState<number | null>(null);
  const socket = useSharedChatSocket();

  const refresh = useCallback(async () => {
    const { data } = await api.GET('/v1/conversations/unread-count');
    if (data) {
      setCount(data.count);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!socket) {
      return;
    }
    function handleUpdated() {
      void refresh();
    }
    socket.on(SERVER_SOCKET_EVENTS.CONVERSATION_UPDATED, handleUpdated);
    return () => {
      socket.off(SERVER_SOCKET_EVENTS.CONVERSATION_UPDATED, handleUpdated);
    };
  }, [socket, refresh]);

  if (!count) {
    return null;
  }

  return (
    <span
      aria-label={String(count)}
      className="flex size-4 items-center justify-center rounded-full bg-destructive text-[10px] font-medium text-destructive-foreground"
    >
      {count > 9 ? '9+' : count}
    </span>
  );
}
