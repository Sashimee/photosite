import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { store } from 'expo-router/build/global-state/router-store';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import type { ReactNode } from 'react';

jest.mock('../../src/lib/auth-context', () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => children,
  useAuth: () => ({ status: 'signed-in', user: { id: 'me' } }),
}));

jest.mock('../../src/lib/api', () => ({
  api: { GET: jest.fn(), POST: jest.fn() },
  setUnauthorizedListener: jest.fn(),
}));

const { createFakeSocket, installAppState } = jest.requireActual<
  typeof import('../../src/testing/fake-socket')
>('../../src/testing/fake-socket');
const mockFake = createFakeSocket();

jest.mock('socket.io-client', () => ({ io: () => mockFake.socket }));

import '../../src/lib/i18n';
import { api } from '../../src/lib/api';
import { resetChatSocketForTesting } from '../../src/lib/chat-socket';

const mockedGet = jest.mocked(api.GET);

function makeConversation(id: string, name: string, unreadCount: number) {
  return {
    id,
    type: 'quote',
    subjectId: 'q1',
    subjectRef: { type: 'quote', quoteId: 'q1', requestTitle: 'Wedding in Esch' },
    participants: [
      { userId: 'me', user: { id: 'me', displayName: null, avatarUrl: null }, lastReadAt: null },
      {
        userId: `${id}-other`,
        user: { id: `${id}-other`, displayName: name, avatarUrl: null },
        lastReadAt: null,
      },
    ],
    lastMessageAt: '2026-10-06T10:00:00.000Z',
    lastMessagePreview: `last of ${id}`,
    unreadCount,
    archivedByMe: false,
  };
}

function ok<T>(data: T) {
  return { data, error: undefined, response: new Response(null, { status: 200 }) };
}

let appState: ReturnType<typeof installAppState>;
let unreadCountFromApi: number;
let conversations: ReturnType<typeof makeConversation>[];

beforeEach(() => {
  jest.clearAllMocks();
  resetChatSocketForTesting();
  mockFake.reset();
  appState = installAppState();
  unreadCountFromApi = 7;
  conversations = [
    makeConversation('c1', 'Alice Photo', 2),
    makeConversation('c2', 'Bob Video', 0),
  ];
  mockedGet.mockImplementation(((path: string) => {
    if (path === '/v1/conversations/unread-count') {
      return Promise.resolve(ok({ count: unreadCountFromApi }));
    }
    if (path === '/v1/conversations') {
      return Promise.resolve(ok({ items: conversations, nextCursor: null }));
    }
    return Promise.reject(new Error(`unexpected GET ${path}`));
  }) as never);
});

describe('messages tab', () => {
  it('lists conversations from the real en catalog with the other party, subject and preview', async () => {
    renderRouter('./app', { initialUrl: '/messages' });

    await screen.findByTestId('conversation-c1');
    expect(screen.getByText('Alice Photo')).toBeTruthy();
    expect(screen.getByText('Bob Video')).toBeTruthy();
    expect(screen.getAllByText('About: Wedding in Esch')).toHaveLength(2);
    expect(screen.getByText('last of c1')).toBeTruthy();
    expect(screen.getByTestId('conversation-unread-c1')).toBeTruthy();
    expect(screen.queryByTestId('conversation-unread-c2')).toBeNull();
  });

  it('shows the API unread count on the tab, not a tally of the rows', async () => {
    renderRouter('./app', { initialUrl: '/messages' });

    await screen.findByTestId('conversation-c1');
    await waitFor(() => {
      expect(screen.getByText('7')).toBeTruthy();
    });
    expect(mockedGet).toHaveBeenCalledWith('/v1/conversations/unread-count');
  });

  it('refreshes the tab count when a conversation update arrives', async () => {
    renderRouter('./app', { initialUrl: '/messages' });
    await waitFor(() => {
      expect(screen.getByText('7')).toBeTruthy();
    });

    unreadCountFromApi = 11;
    mockFake.receive('conversation:updated', { conversation: conversations[0] });

    await waitFor(() => {
      expect(screen.getByText('11')).toBeTruthy();
    });
  });

  it('reloads the rows when the app returns from the background', async () => {
    renderRouter('./app', { initialUrl: '/messages' });
    await screen.findByTestId('conversation-c1');

    appState.set('background');
    conversations = [makeConversation('c3', 'Carol Studio', 1), ...conversations];
    expect(screen.queryByTestId('conversation-c3')).toBeNull();
    appState.set('active');

    await screen.findByTestId('conversation-c3');
  });

  it('shows an empty state', async () => {
    conversations = [];
    unreadCountFromApi = 0;
    renderRouter('./app', { initialUrl: '/messages' });

    await screen.findByText('No conversations yet.');
  });

  it('opens a thread from a row', async () => {
    renderRouter('./app', { initialUrl: '/messages' });

    fireEvent.press(await screen.findByTestId('conversation-c2'));

    await waitFor(() => {
      expect(store.getRouteInfo().pathname).toBe('/messages/c2');
    });
  });
});
