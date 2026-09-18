import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('socket.io-client', () => {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const socket = {
    connected: false,
    // Real socket.io-client connects asynchronously: `.connected` only
    // flips once the transport actually fires `connect`/`disconnect`, never
    // synchronously inside the `connect()`/`disconnect()` call itself.
    connect: vi.fn(),
    disconnect: vi.fn(),
    on: vi.fn((event: string, callback: (...args: unknown[]) => void) => {
      let set = listeners.get(event);
      if (!set) {
        set = new Set();
        listeners.set(event, set);
      }
      set.add(callback);
    }),
    off: vi.fn((event: string, callback: (...args: unknown[]) => void) => {
      listeners.get(event)?.delete(callback);
    }),
  };
  function emit(event: string) {
    if (event === 'connect') socket.connected = true;
    if (event === 'disconnect') socket.connected = false;
    for (const callback of listeners.get(event) ?? []) callback();
  }
  return { io: vi.fn(() => socket), __mockSocket: socket, __emit: emit };
});

async function importChatSocket() {
  return import('./chat-socket');
}

async function importSocketIoMock() {
  return import('socket.io-client') as unknown as Promise<{
    io: ReturnType<typeof vi.fn>;
    __mockSocket: {
      connected: boolean;
      connect: ReturnType<typeof vi.fn>;
      disconnect: ReturnType<typeof vi.fn>;
    };
    __emit: (event: string) => void;
  }>;
}

describe('useChatSocket', () => {
  afterEach(async () => {
    const { resetChatSocketForTesting } = await importChatSocket();
    resetChatSocketForTesting();
    vi.clearAllMocks();
  });

  it('builds one socket shared across concurrently mounted consumers', async () => {
    const { useChatSocket } = await importChatSocket();
    const { io } = await importSocketIoMock();

    const first = renderHook(() => useChatSocket());
    const second = renderHook(() => useChatSocket());

    expect(io).toHaveBeenCalledTimes(1);
    expect(first.result.current.socket).toBe(second.result.current.socket);

    first.unmount();
    second.unmount();
  });

  it('connects once on first mount and disconnects only after the last consumer unmounts', async () => {
    const { useChatSocket } = await importChatSocket();
    const { __mockSocket } = await importSocketIoMock();

    const first = renderHook(() => useChatSocket());
    const second = renderHook(() => useChatSocket());
    expect(__mockSocket.connect).toHaveBeenCalledTimes(1);

    first.unmount();
    expect(__mockSocket.disconnect).not.toHaveBeenCalled();

    second.unmount();
    expect(__mockSocket.disconnect).toHaveBeenCalledTimes(1);
  });

  it('reflects connect and disconnect events from the socket', async () => {
    const { useChatSocket } = await importChatSocket();
    const { __emit } = await importSocketIoMock();

    const { result, unmount } = renderHook(() => useChatSocket());
    expect(result.current.connected).toBe(false);

    act(() => {
      __emit('connect');
    });
    expect(result.current.connected).toBe(true);

    act(() => {
      __emit('disconnect');
    });
    expect(result.current.connected).toBe(false);

    unmount();
  });
});

describe('useSharedChatSocket', () => {
  afterEach(async () => {
    const { resetChatSocketForTesting } = await importChatSocket();
    resetChatSocketForTesting();
    vi.clearAllMocks();
  });

  it('is null when no messages page has opened a socket', async () => {
    const { useSharedChatSocket } = await importChatSocket();

    const { result, unmount } = renderHook(() => useSharedChatSocket());

    expect(result.current).toBeNull();
    unmount();
  });

  it('picks up the socket once a messages page opens one, and loses it again once closed', async () => {
    const { useChatSocket, useSharedChatSocket } = await importChatSocket();

    const badge = renderHook(() => useSharedChatSocket());
    expect(badge.result.current).toBeNull();

    const page = renderHook(() => useChatSocket());
    expect(badge.result.current).toBe(page.result.current.socket);

    page.unmount();
    expect(badge.result.current).toBeNull();

    badge.unmount();
  });
});
