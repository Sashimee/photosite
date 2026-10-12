import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';

import { useAuth } from './auth-context';
import { conversationHrefFromPushData } from './notification-links';
import { registerPushDevice } from './push';

export function usePushRegistration(): void {
  const { status } = useAuth();

  useEffect(() => {
    if (status === 'signed-in') {
      void registerPushDevice();
    }
  }, [status]);
}

export function useNotificationRouting(): void {
  const { status } = useAuth();
  const router = useRouter();
  const pendingHrefRef = useRef<string | null>(null);
  const handledRef = useRef(new Set<string>());
  const statusRef = useRef(status);
  statusRef.current = status;

  const flush = useCallback(() => {
    const href = pendingHrefRef.current;
    pendingHrefRef.current = null;
    if (href) {
      router.push(href, { dangerouslySingular: true });
    }
  }, [router]);

  useEffect(() => {
    function remember(response: Notifications.NotificationResponse | null) {
      if (!response) {
        return;
      }
      const { identifier, content } = response.notification.request;
      if (handledRef.current.has(identifier)) {
        return;
      }
      handledRef.current.add(identifier);
      pendingHrefRef.current = conversationHrefFromPushData(content.data);
      if (statusRef.current === 'signed-in') {
        flush();
      }
    }

    remember(Notifications.getLastNotificationResponse());
    const subscription = Notifications.addNotificationResponseReceivedListener(remember);
    return () => {
      subscription.remove();
    };
  }, [flush]);

  useEffect(() => {
    if (status === 'signed-in') {
      flush();
    } else if (status === 'signed-out') {
      pendingHrefRef.current = null;
    }
  }, [status, flush]);
}
