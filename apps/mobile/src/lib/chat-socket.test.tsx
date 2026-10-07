import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { renderHook } from '@testing-library/react-native';
import { io } from 'socket.io-client';

import { createFakeSocket, installAppState } from '../testing/fake-socket';

const mockFake = createFakeSocket();

jest.mock('socket.io-client', () => ({ io: jest.fn(() => mockFake.socket) }));

const mockGetSessionToken = jest.fn<() => Promise<string | null>>();
jest.mock('./session', () => ({
  getSessionToken: () => mockGetSessionToken(),
}));

import { resetChatSocketForTesting, useChatSocket } from './chat-socket';

type AuthCallback = (callback: (data: Record<string, unknown>) => void) => void;

function handshakeAuth(): AuthCallback {
  const options = jest.mocked(io).mock.calls[0]?.[1];
  if (typeof options?.auth !== 'function') {
    throw new Error('the socket was created without an auth callback');
  }
  return options.auth as AuthCallback;
}

function readHandshake(): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    handshakeAuth()(resolve);
  });
}

beforeEach(() => {
  resetChatSocketForTesting();
  mockFake.reset();
  jest.mocked(io).mockClear();
  mockGetSessionToken.mockReset();
});

describe('chat socket', () => {
  it('reads the bearer token from secure storage on every connection attempt', async () => {
    installAppState();
    mockGetSessionToken.mockResolvedValueOnce('token-1').mockResolvedValueOnce('token-2');
    renderHook(() => useChatSocket());

    expect(await readHandshake()).toEqual({ token: 'token-1' });
    expect(await readHandshake()).toEqual({ token: 'token-2' });
    expect(mockGetSessionToken).toHaveBeenCalledTimes(2);
  });

  it('sends an empty handshake when there is no session', async () => {
    installAppState();
    mockGetSessionToken.mockResolvedValue(null);
    renderHook(() => useChatSocket());

    expect(await readHandshake()).toEqual({});
  });

  it('disconnects when the app leaves active and reconnects on return', () => {
    const appState = installAppState();
    const { result } = renderHook(() => useChatSocket());

    expect(result.current.connected).toBe(true);

    appState.set('background');
    expect(mockFake.socket.disconnect).toHaveBeenCalled();
    expect(result.current.connected).toBe(false);

    appState.set('active');
    expect(result.current.connected).toBe(true);
  });

  it('opens one connection for several consumers and closes after the last unmounts', () => {
    installAppState();
    const first = renderHook(() => useChatSocket());
    const second = renderHook(() => useChatSocket());

    expect(io).toHaveBeenCalledTimes(1);
    expect(mockFake.socket.connect).toHaveBeenCalledTimes(1);

    first.unmount();
    expect(mockFake.socket.connected).toBe(true);

    second.unmount();
    expect(mockFake.socket.connected).toBe(false);
  });

  it('does not reconnect on return to active once every consumer has gone', () => {
    const appState = installAppState();
    const { unmount } = renderHook(() => useChatSocket());
    unmount();
    mockFake.socket.connect.mockClear();

    appState.set('active');

    expect(mockFake.socket.connect).not.toHaveBeenCalled();
  });

  it('stays closed while disabled', () => {
    installAppState();
    renderHook(() => useChatSocket(false));

    expect(mockFake.socket.connect).not.toHaveBeenCalled();
  });
});
