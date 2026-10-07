import { useEffect, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { io, type Socket } from 'socket.io-client';

import { env } from './env';
import { getSessionToken } from './session';

const SOCKET_PATH = '/v1/socket.io';

let sharedSocket: Socket | null = null;
let refCount = 0;
let appStateSubscription: { remove: () => void } | null = null;

export function getChatSocket(): Socket {
  sharedSocket ??= io(env.EXPO_PUBLIC_API_URL, {
    path: SOCKET_PATH,
    autoConnect: false,
    transports: ['websocket'],
    auth: (callback) => {
      void getSessionToken().then((token) => {
        callback(token ? { token } : {});
      });
    },
  });
  return sharedSocket;
}

function handleAppStateChange(state: AppStateStatus): void {
  const socket = getChatSocket();
  if (state === 'active') {
    if (refCount > 0) {
      socket.connect();
    }
  } else {
    socket.disconnect();
  }
}

function acquire(): void {
  refCount += 1;
  if (refCount > 1) {
    return;
  }
  appStateSubscription = AppState.addEventListener('change', handleAppStateChange);
  if (AppState.currentState === 'active') {
    getChatSocket().connect();
  }
}

function release(): void {
  refCount -= 1;
  if (refCount > 0) {
    return;
  }
  appStateSubscription?.remove();
  appStateSubscription = null;
  getChatSocket().disconnect();
}

export interface UseChatSocketResult {
  socket: Socket;
  connected: boolean;
}

// Held open only while a messages screen asks for it: the connection is an
// optimisation for the foreground, push delivers to a backgrounded app.
export function useChatSocket(enabled = true): UseChatSocketResult {
  const socket = getChatSocket();
  const [connected, setConnected] = useState(socket.connected);

  useEffect(() => {
    function handleConnect() {
      setConnected(true);
    }
    function handleDisconnect() {
      setConnected(false);
    }
    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    setConnected(socket.connected);
    return () => {
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
    };
  }, [socket]);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    acquire();
    return release;
  }, [enabled]);

  return { socket, connected };
}

export function resetChatSocketForTesting(): void {
  sharedSocket?.disconnect();
  sharedSocket = null;
  refCount = 0;
  appStateSubscription?.remove();
  appStateSubscription = null;
}
