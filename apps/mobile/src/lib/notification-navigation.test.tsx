import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Stack } from 'expo-router';
import { act, renderRouter } from 'expo-router/testing-library';
import { Text } from 'react-native';

let mockStatus: 'loading' | 'signed-in' | 'signed-out' = 'signed-in';
jest.mock('./auth-context', () => ({ useAuth: () => ({ status: mockStatus }) }));

const mockLastResponse = jest.fn<() => unknown>();
const mockListeners: ((response: unknown) => void)[] = [];
jest.mock('expo-notifications', () => ({
  getLastNotificationResponse: () => mockLastResponse(),
  addNotificationResponseReceivedListener: (listener: (response: unknown) => void) => {
    mockListeners.push(listener);
    return { remove: () => undefined };
  },
}));

import { useNotificationRouting } from './use-push-lifecycle';

const A = '3fa85f64-5717-4562-b3fc-2c963f66afa6';

function tap(identifier: string, id: string) {
  return {
    notification: { request: { identifier, content: { data: { url: `/en/messages/${id}` } } } },
  };
}

function Root() {
  useNotificationRouting();
  return <Stack screenOptions={{ headerShown: false }} />;
}

function render(initialUrl: string) {
  return renderRouter(
    {
      _layout: Root,
      index: () => <Text>home</Text>,
      'messages/[id]': () => <Text>thread</Text>,
    },
    { initialUrl },
  );
}

interface NavState {
  routes: { name: string; state?: NavState }[];
}

function stackRouteNames(view: ReturnType<typeof render>): string[] {
  const root = view.getRouterState() as NavState | undefined;
  return root?.routes[0]?.state?.routes.map((route) => route.name) ?? [];
}

beforeEach(() => {
  mockListeners.length = 0;
  mockStatus = 'signed-in';
  mockLastResponse.mockReturnValue(null);
});

describe('notification navigation', () => {
  it('adds no second entry when the tapped thread is already open', () => {
    const view = render(`/messages/${A}`);
    const before = stackRouteNames(view).length;

    act(() => {
      mockListeners[0]?.(tap('n1', A));
    });
    act(() => {
      mockListeners[0]?.(tap('n2', A));
    });

    expect(stackRouteNames(view)).toHaveLength(before);
    expect(view.getPathname()).toBe(`/messages/${A}`);
  });

  it('does not stack the same thread on repeated taps', () => {
    const view = render('/');

    act(() => {
      mockListeners[0]?.(tap('n3', A));
    });
    act(() => {
      mockListeners[0]?.(tap('n4', A));
    });

    expect(stackRouteNames(view).filter((name) => name === 'messages/[id]')).toHaveLength(1);
    expect(view.getPathname()).toBe(`/messages/${A}`);
  });

  it('keeps the root screen under the thread on a cold-start tap', () => {
    mockLastResponse.mockReturnValue(tap('n5', A));
    const view = render('/');

    expect(stackRouteNames(view)).toEqual(['index', 'messages/[id]']);
    expect(view.getPathname()).toBe(`/messages/${A}`);
  });
});
