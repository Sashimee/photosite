import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { renderHook } from '@testing-library/react-native';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));

let mockStatus: 'loading' | 'signed-in' | 'signed-out' = 'loading';
jest.mock('./auth-context', () => ({ useAuth: () => ({ status: mockStatus }) }));

const mockRegister = jest.fn<() => Promise<string>>();
jest.mock('./push', () => ({ registerPushDevice: () => mockRegister() }));

const mockLastResponse = jest.fn<() => unknown>();
const mockListeners: ((response: unknown) => void)[] = [];
jest.mock('expo-notifications', () => ({
  getLastNotificationResponse: () => mockLastResponse(),
  addNotificationResponseReceivedListener: (listener: (response: unknown) => void) => {
    mockListeners.push(listener);
    return { remove: () => undefined };
  },
}));

import { useNotificationRouting, usePushRegistration } from './use-push-lifecycle';

const ID = '3fa85f64-5717-4562-b3fc-2c963f66afa6';

function tap(identifier: string, data: unknown) {
  return { notification: { request: { identifier, content: { data } } } };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockListeners.length = 0;
  mockStatus = 'loading';
  mockLastResponse.mockReturnValue(null);
  mockRegister.mockResolvedValue('registered');
});

describe('useNotificationRouting', () => {
  it('holds a cold-start tap until the session is restored, then opens the conversation', () => {
    mockLastResponse.mockReturnValue(tap('n1', { url: `/en/messages/${ID}` }));
    const { rerender } = renderHook(() => {
      useNotificationRouting();
    });
    expect(mockPush).not.toHaveBeenCalled();

    mockStatus = 'signed-in';
    rerender({});

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith(`/messages/${ID}`);
  });

  it('opens the conversation straight away for a tap while signed in', () => {
    mockStatus = 'signed-in';
    renderHook(() => {
      useNotificationRouting();
    });

    mockListeners[0]?.(tap('n2', { url: `/de/messages/${ID}` }));

    expect(mockPush).toHaveBeenCalledWith(`/messages/${ID}`);
  });

  it('does not navigate for a malformed or foreign payload', () => {
    mockStatus = 'signed-in';
    renderHook(() => {
      useNotificationRouting();
    });

    mockListeners[0]?.(tap('n3', { url: 'https://evil.example/en/messages/x' }));
    mockListeners[0]?.(tap('n4', { url: '/en/messages/not-a-uuid' }));
    mockListeners[0]?.(tap('n5', undefined));

    expect(mockPush).not.toHaveBeenCalled();
  });

  it('does not open a stale tap for whoever signs in next', () => {
    mockLastResponse.mockReturnValue(tap('n6', { url: `/en/messages/${ID}` }));
    const { rerender } = renderHook(() => {
      useNotificationRouting();
    });

    mockStatus = 'signed-out';
    rerender({});
    mockStatus = 'signed-in';
    rerender({});

    expect(mockPush).not.toHaveBeenCalled();
  });

  it('handles the same notification once', () => {
    mockStatus = 'signed-in';
    mockLastResponse.mockReturnValue(tap('n7', { url: `/en/messages/${ID}` }));
    renderHook(() => {
      useNotificationRouting();
    });

    mockListeners[0]?.(tap('n7', { url: `/en/messages/${ID}` }));

    expect(mockPush).toHaveBeenCalledTimes(1);
  });
});

describe('usePushRegistration', () => {
  it('registers only once signed in', () => {
    const { rerender } = renderHook(() => {
      usePushRegistration();
    });
    expect(mockRegister).not.toHaveBeenCalled();

    mockStatus = 'signed-in';
    rerender({});

    expect(mockRegister).toHaveBeenCalledTimes(1);
  });
});
