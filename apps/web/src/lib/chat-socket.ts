'use client';

import { useEffect, useState } from 'react';
import { io, type Socket } from 'socket.io-client';

import { env } from './env';

const SOCKET_PATH = '/v1/socket.io';

let sharedSocket: Socket | null = null;
let refCount = 0;
const availabilityListeners = new Set<(socket: Socket | null) => void>();

function setSharedSocket(next: Socket | null): void {
  sharedSocket = next;
  for (const listener of availabilityListeners) listener(next);
}

function getSharedSocket(): Socket {
  if (!sharedSocket) {
    setSharedSocket(
      io(env.NEXT_PUBLIC_API_URL, {
        path: SOCKET_PATH,
        withCredentials: true,
        autoConnect: false,
      }),
    );
  }
  const socket = sharedSocket;
  if (!socket) {
    throw new Error('chat socket was not initialized');
  }
  return socket;
}

export interface UseChatSocketResult {
  socket: Socket;
  connected: boolean;
}

// One socket for every mounted consumer (the messages list and thread pages
// only, per docs/steps/1B.6-chat-ui.md): a ref count keeps it open while any
// of them is mounted and closes it the moment the last one unmounts, so no
// other page holds an open connection.
export function useChatSocket(): UseChatSocketResult {
  const socket = getSharedSocket();
  const [connected, setConnected] = useState(socket.connected);

  useEffect(() => {
    refCount += 1;
    if (refCount === 1) {
      socket.connect();
    }

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
      refCount -= 1;
      if (refCount === 0) {
        socket.disconnect();
        setSharedSocket(null);
      }
    };
  }, [socket]);

  return { socket, connected };
}

// The header's unread badge is mounted on every page but must never itself
// hold a connection open outside the messages pages, so it only observes
// whatever socket `useChatSocket` already has open, and gets `null` (no
// live updates) the rest of the time.
export function useSharedChatSocket(): Socket | null {
  const [socket, setSocket] = useState<Socket | null>(sharedSocket);

  useEffect(() => {
    setSocket(sharedSocket);
    availabilityListeners.add(setSocket);
    return () => {
      availabilityListeners.delete(setSocket);
    };
  }, []);

  return socket;
}

// Test-only: forces the next call to `useChatSocket` to build a fresh
// socket instead of reusing one left over from a previous test.
export function resetChatSocketForTesting(): void {
  sharedSocket?.disconnect();
  setSharedSocket(null);
  refCount = 0;
  availabilityListeners.clear();
}
