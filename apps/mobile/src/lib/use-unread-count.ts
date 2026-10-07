import * as Notifications from 'expo-notifications';
import { usePathname } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';

import { SERVER_SOCKET_EVENTS } from '@photoo/shared';

import { api } from './api';
import { useAuth } from './auth-context';
import { getChatSocket } from './chat-socket';
import { useAppActive } from './use-screen-visible';

export function useUnreadCount(): number {
  const { status } = useAuth();
  const pathname = usePathname();
  const appActive = useAppActive();
  const [count, setCount] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const { data } = await api.GET('/v1/conversations/unread-count');
      if (data) {
        setCount(data.count);
      }
    } catch {
      return;
    }
  }, []);

  const signedIn = status === 'signed-in';

  useEffect(() => {
    if (!signedIn) {
      setCount(0);
      return;
    }
    if (appActive) {
      void refresh();
    }
  }, [signedIn, appActive, pathname, refresh]);

  useEffect(() => {
    if (!signedIn) {
      return;
    }
    const socket = getChatSocket();
    function handleUpdated() {
      void refresh();
    }
    socket.on(SERVER_SOCKET_EVENTS.CONVERSATION_UPDATED, handleUpdated);
    return () => {
      socket.off(SERVER_SOCKET_EVENTS.CONVERSATION_UPDATED, handleUpdated);
    };
  }, [signedIn, refresh]);

  useEffect(() => {
    void Notifications.setBadgeCountAsync(signedIn ? count : 0).catch(() => undefined);
  }, [signedIn, count]);

  return count;
}
