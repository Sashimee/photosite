import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { Linking } from 'react-native';
import type { ReactNode } from 'react';

jest.mock('../../src/lib/auth-context', () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => children,
  useAuth: () => ({ status: 'signed-in', user: { id: 'me' } }),
}));

jest.mock('../../src/lib/api', () => ({
  api: { GET: jest.fn(), POST: jest.fn() },
  setUnauthorizedListener: jest.fn(),
}));

jest.mock('../../src/lib/use-unread-count', () => ({ useUnreadCount: () => 0 }));

const mockRequestCamera = jest.fn<() => Promise<{ granted: boolean; canAskAgain: boolean }>>();
const mockRequestLibrary = jest.fn<() => Promise<{ granted: boolean; canAskAgain: boolean }>>();
const mockLaunchCamera = jest.fn();
const mockLaunchLibrary = jest.fn<(options: unknown) => Promise<unknown>>();
jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: () => mockRequestCamera(),
  requestMediaLibraryPermissionsAsync: () => mockRequestLibrary(),
  launchCameraAsync: (options: unknown) => mockLaunchCamera(options),
  launchImageLibraryAsync: (options: unknown) => mockLaunchLibrary(options),
}));

const mockGetDocument = jest.fn<(options: unknown) => Promise<unknown>>();
jest.mock('expo-document-picker', () => ({
  getDocumentAsync: (options: unknown) => mockGetDocument(options),
}));

jest.mock('expo-image-manipulator', () => ({
  SaveFormat: { JPEG: 'jpeg' },
  ImageManipulator: { manipulate: jest.fn() },
}));

const { createFakeSocket, installAppState } = jest.requireActual<
  typeof import('../../src/testing/fake-socket')
>('../../src/testing/fake-socket');
const mockFake = createFakeSocket();

jest.mock('socket.io-client', () => ({ io: () => mockFake.socket }));

import '../../src/lib/i18n';
import { api } from '../../src/lib/api';
import { resetChatSocketForTesting } from '../../src/lib/chat-socket';
import { installFakeFetch, installFakeXhr } from '../../src/testing/fake-upload';

const mockedGet = jest.mocked(api.GET);

interface TestMessage {
  id: string;
  conversationId: string;
  senderId: string;
  body: string | null;
  attachments: { id: string; kind: 'image' | 'document'; mimeType: string; sizeBytes: number }[];
  editedAt: null;
  deletedAt: null;
  createdAt: string;
}

function makeMessage(id: string, createdAt: string, overrides: Partial<TestMessage> = {}) {
  return {
    id,
    conversationId: 'c1',
    senderId: 'other',
    body: `body ${id}`,
    attachments: [],
    editedAt: null,
    deletedAt: null,
    createdAt,
    ...overrides,
  } satisfies TestMessage;
}

const conversation = {
  id: 'c1',
  type: 'quote',
  subjectId: 'q1',
  subjectRef: null,
  participants: [
    { userId: 'me', user: { id: 'me', displayName: null, avatarUrl: null }, lastReadAt: null },
    {
      userId: 'other',
      user: { id: 'other', displayName: 'Alice Photo', avatarUrl: null },
      lastReadAt: null,
    },
  ],
  lastMessageAt: null,
  lastMessagePreview: null,
  unreadCount: 0,
  archivedByMe: false,
};

function ok<T>(data: T) {
  return { data, error: undefined, response: new Response(null, { status: 200 }) };
}

let serverMessages: TestMessage[];
let olderMessages: TestMessage[];
let nextCursor: string | null;
let appState: ReturnType<typeof installAppState>;

function messageGetCalls() {
  const calls: unknown[][] = mockedGet.mock.calls;
  return calls.filter(([path]) => path === '/v1/conversations/{id}/messages');
}

function installApi(conversationStatus = 200) {
  mockedGet.mockImplementation(((path: string, init?: { params?: { query?: object } }) => {
    if (path === '/v1/conversations/{id}') {
      if (conversationStatus === 404) {
        return Promise.resolve({
          data: undefined,
          error: { code: 'NOT_FOUND' },
          response: new Response(null, { status: 404 }),
        });
      }
      return Promise.resolve(ok(conversation));
    }
    if (path === '/v1/conversations/{id}/messages') {
      const cursor = (init?.params?.query as { cursor?: string } | undefined)?.cursor;
      return Promise.resolve(
        cursor
          ? ok({ items: olderMessages, nextCursor: null })
          : ok({ items: [...serverMessages].reverse(), nextCursor }),
      );
    }
    if (path === '/v1/uploads/{id}') {
      return Promise.resolve(ok({ id: 'up1', status: 'clean' }));
    }
    if (path.endsWith('/download')) {
      return Promise.resolve(
        ok({ url: 'https://files.example.com/doc.pdf', expiresAt: '2999-01-01T00:00:00Z' }),
      );
    }
    return Promise.reject(new Error(`unexpected GET ${path}`));
  }) as never);
}

async function openThread() {
  renderRouter('./app', { initialUrl: '/messages/c1' });
  await screen.findByTestId('thread-list');
  await waitFor(() => {
    expect(mockFake.emittedEvents('conversation:join')).toHaveLength(1);
  });
}

function send(text: string) {
  fireEvent.changeText(screen.getByTestId('composer-input'), text);
  fireEvent.press(screen.getByTestId('composer-send'));
}

beforeEach(() => {
  jest.clearAllMocks();
  resetChatSocketForTesting();
  mockFake.reset();
  appState = installAppState();
  serverMessages = [makeMessage('m1', '2026-10-05T09:00:00.000Z')];
  olderMessages = [];
  nextCursor = null;
  installApi();
});

describe('message thread', () => {
  it('renders the conversation from the real en catalog, grouped by day, as plain text', async () => {
    serverMessages = [
      makeMessage('m1', '2026-10-05T09:00:00.000Z', { body: 'See https://example.com now' }),
      makeMessage('m2', '2026-10-06T09:00:00.000Z', { senderId: 'me', body: 'Thanks' }),
    ];
    await openThread();

    expect(screen.getAllByText('Alice Photo').length).toBeGreaterThan(0);
    expect(screen.getByText('See https://example.com now')).toBeTruthy();
    expect(screen.getByText('Thanks')).toBeTruthy();
    expect(screen.getByPlaceholderText('Write a message…')).toBeTruthy();
    expect(screen.getByText('Send')).toBeTruthy();
    expect(screen.getByText('Oct 5, 2026')).toBeTruthy();
    expect(screen.getByText('Oct 6, 2026')).toBeTruthy();
  });

  it('shows a not-found state when the conversation is not the viewer’s', async () => {
    installApi(404);
    renderRouter('./app', { initialUrl: '/messages/c1' });

    await screen.findByTestId('thread-not-found');
    expect(screen.getByText("This conversation doesn't exist, or it isn't yours.")).toBeTruthy();
    expect(screen.queryByTestId('composer-input')).toBeNull();
  });

  it('keeps one copy of an optimistic message when the echoed message:new arrives first', async () => {
    let acknowledge: (value: unknown) => void = () => undefined;
    mockFake.respondTo('message:send', () => new Promise((resolve) => (acknowledge = resolve)));
    await openThread();

    send('Hello there');
    await screen.findByText('Sending…');
    expect(screen.getAllByText('Hello there')).toHaveLength(1);

    const stored = makeMessage('m2', '2026-10-06T10:00:00.000Z', {
      senderId: 'me',
      body: 'Hello there',
    });
    mockFake.receive('message:new', { message: stored });
    await act(async () => {
      acknowledge({ ok: true, data: { message: stored } });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.queryByText('Sending…')).toBeNull();
    });
    expect(screen.getAllByText('Hello there')).toHaveLength(1);
    expect(screen.getByTestId('message-m2')).toBeTruthy();
  });

  it('keeps the text of a failed send, offers a retry, and sends it again once', async () => {
    mockFake.respondTo('message:send', () => ({
      ok: false,
      error: { code: 'TOO_MANY_REQUESTS', message: 'slow' },
    }));
    await openThread();

    send('Please retry me');

    await screen.findByText('Not sent.');
    expect(screen.getByText('Please retry me')).toBeTruthy();
    expect(
      screen.getByText("You're sending messages too fast. Slow down and try again."),
    ).toBeTruthy();
    expect(screen.getByTestId('composer-input').props.value).toBe('');

    const stored = makeMessage('m3', '2026-10-06T10:00:00.000Z', {
      senderId: 'me',
      body: 'Please retry me',
    });
    mockFake.respondTo('message:send', () => ({ ok: true, data: { message: stored } }));
    const retry = screen.getByText('Retry');
    fireEvent.press(retry);
    fireEvent.press(retry);

    await waitFor(() => {
      expect(screen.queryByText('Not sent.')).toBeNull();
    });
    expect(screen.getAllByText('Please retry me')).toHaveLength(1);
    expect(mockFake.emittedEvents('message:send')).toHaveLength(2);
  });

  it('sends once when the send button is tapped twice', async () => {
    const stored = makeMessage('m8', '2026-10-06T10:00:00.000Z', {
      senderId: 'me',
      body: 'Only once',
    });
    mockFake.respondTo('message:send', () => ({ ok: true, data: { message: stored } }));
    await openThread();

    fireEvent.changeText(screen.getByTestId('composer-input'), 'Only once');
    const button = screen.getByTestId('composer-send');
    fireEvent.press(button);
    fireEvent.press(button);

    await waitFor(() => {
      expect(mockFake.emittedEvents('message:send')).toHaveLength(1);
    });
  });

  it('falls back to the REST endpoint while the socket is down', async () => {
    const stored = makeMessage('m4', '2026-10-06T10:00:00.000Z', {
      senderId: 'me',
      body: 'Offline',
    });
    jest.mocked(api.POST).mockResolvedValue({
      data: stored,
      error: undefined,
      response: new Response(null, { status: 201 }),
    });
    await openThread();
    act(() => {
      mockFake.socket.disconnect();
    });

    send('Offline');

    await screen.findByTestId('message-m4');
    expect(api.POST).toHaveBeenCalledWith('/v1/conversations/{id}/messages', {
      params: { path: { id: 'c1' } },
      body: { body: 'Offline' },
    });
  });

  it('emits typing at most once per throttle window', async () => {
    await openThread();
    const input = screen.getByTestId('composer-input');

    fireEvent.changeText(input, 'h');
    fireEvent.changeText(input, 'he');
    fireEvent.changeText(input, 'hel');

    expect(mockFake.emittedEvents('typing')).toEqual([{ conversationId: 'c1', isTyping: true }]);
  });

  it('shows the other participant typing', async () => {
    await openThread();

    mockFake.receive('typing', { conversationId: 'c1', userId: 'other', isTyping: true });

    expect(await screen.findByText('Alice Photo is typing…')).toBeTruthy();
  });

  it('marks the thread read only while the app is active', async () => {
    await openThread();
    await waitFor(() => {
      expect(mockFake.emittedEvents('read')).toEqual([
        { conversationId: 'c1', upToMessageId: 'm1' },
      ]);
    });

    appState.set('background');
    serverMessages = [...serverMessages, makeMessage('m5', '2026-10-06T11:00:00.000Z')];
    mockFake.receive('message:new', { message: serverMessages[1] });
    expect(mockFake.emittedEvents('read')).toHaveLength(1);

    appState.set('active');
    await waitFor(() => {
      expect(mockFake.emittedEvents('read')).toContainEqual({
        conversationId: 'c1',
        upToMessageId: 'm5',
      });
    });
  });

  it('refetches the first page and rejoins when the app returns from the background', async () => {
    await openThread();
    expect(messageGetCalls()).toHaveLength(1);

    appState.set('background');
    expect(screen.queryByTestId('thread-reconnecting')).not.toBeNull();
    serverMessages = [
      ...serverMessages,
      makeMessage('m6', '2026-10-06T12:00:00.000Z', { body: 'while away' }),
    ];

    appState.set('active');

    await screen.findByText('while away');
    expect(messageGetCalls()).toHaveLength(2);
    await waitFor(() => {
      expect(mockFake.emittedEvents('conversation:join')).toHaveLength(2);
    });
    expect(screen.queryByTestId('thread-reconnecting')).toBeNull();
  });

  it('loads older messages with the cursor', async () => {
    nextCursor = 'cursor-1';
    olderMessages = [makeMessage('m0', '2026-10-01T09:00:00.000Z', { body: 'way back' })];
    await openThread();

    fireEvent.press(screen.getByTestId('thread-load-older'));

    await screen.findByText('way back');
    expect(messageGetCalls().at(-1)?.[1]).toEqual(
      expect.objectContaining({
        params: expect.objectContaining({ query: { cursor: 'cursor-1' } }),
      }),
    );
    expect(screen.queryByTestId('thread-load-older')).toBeNull();
  });

  it('opens a PDF attachment through a fresh download url', async () => {
    const openUrl = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    serverMessages = [
      makeMessage('m7', '2026-10-05T09:00:00.000Z', {
        body: null,
        attachments: [{ id: 'a1', kind: 'document', mimeType: 'application/pdf', sizeBytes: 2048 }],
      }),
    ];
    await openThread();

    fireEvent.press(screen.getByTestId('attachment-a1'));

    await waitFor(() => {
      expect(openUrl).toHaveBeenCalledWith('https://files.example.com/doc.pdf');
    });
    expect(mockedGet).toHaveBeenCalledWith(
      '/v1/conversations/{id}/messages/{messageId}/attachments/{attachmentId}/download',
      { params: { path: { id: 'c1', messageId: 'm7', attachmentId: 'a1' } } },
    );
    openUrl.mockRestore();
  });
});

describe('attachments', () => {
  const xhr = installFakeXhr();
  let uploadCounter: number;

  function isDisabled(testID: string): boolean {
    const props = screen.getByTestId(testID).props as {
      accessibilityState?: { disabled?: boolean };
    };
    return props.accessibilityState?.disabled === true;
  }

  function photo(index: number) {
    return {
      uri: `file:///photo-${String(index)}.jpg`,
      fileName: `photo-${String(index)}.jpg`,
      mimeType: 'image/jpeg',
      width: 1200,
      height: 900,
    };
  }

  beforeEach(() => {
    xhr.reset();
    uploadCounter = 0;
    installFakeFetch({});
    mockRequestCamera.mockResolvedValue({ granted: true, canAskAgain: true });
    mockRequestLibrary.mockResolvedValue({ granted: true, canAskAgain: true });
    jest.mocked(api.POST).mockImplementation(((path: string) => {
      if (path === '/v1/uploads') {
        uploadCounter += 1;
        return Promise.resolve(
          ok({
            uploadId: `up${String(uploadCounter)}`,
            url: `https://s3.example.com/put-${String(uploadCounter)}`,
            headers: { 'Content-Type': 'image/jpeg' },
          }),
        );
      }
      return Promise.resolve(ok({ id: `up${String(uploadCounter)}` }));
    }) as never);
  });

  function chooseFromLibrary(assets: ReturnType<typeof photo>[]) {
    mockLaunchLibrary.mockResolvedValue({ canceled: false, assets });
    fireEvent.press(screen.getByTestId('composer-attach'));
    expect(screen.getByText('Photo library')).toBeTruthy();
    fireEvent.press(screen.getByTestId('attach-library'));
  }

  it('keeps chat usable when camera permission is denied and offers the settings', async () => {
    mockRequestCamera.mockResolvedValue({ granted: false, canAskAgain: false });
    const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue();
    const stored = makeMessage('m9', '2026-10-06T10:00:00.000Z', {
      senderId: 'me',
      body: 'Still works',
    });
    mockFake.respondTo('message:send', () => ({ ok: true, data: { message: stored } }));
    await openThread();

    fireEvent.press(screen.getByTestId('composer-attach'));
    fireEvent.press(screen.getByTestId('attach-camera'));

    expect(await screen.findByTestId('composer-permission-denied')).toBeTruthy();
    expect(
      screen.getByText(
        'Allow camera access in Settings to take a photo. You can still send messages and choose other files.',
      ),
    ).toBeTruthy();
    expect(mockLaunchCamera).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId('composer-open-settings'));
    expect(openSettings).toHaveBeenCalledTimes(1);
    openSettings.mockRestore();

    send('Still works');
    await waitFor(() => {
      expect(mockFake.emittedEvents('message:send')).toHaveLength(1);
    });
    expect(mockFake.emittedEvents('message:send')[0]).toEqual({
      conversationId: 'c1',
      body: 'Still works',
    });
  });

  it('uploads a picked photo, then sends the message with the upload id once', async () => {
    const stored = makeMessage('m10', '2026-10-06T10:00:00.000Z', {
      senderId: 'me',
      body: null,
      attachments: [{ id: 'att1', kind: 'image', mimeType: 'image/jpeg', sizeBytes: 1024 }],
    });
    mockFake.respondTo('message:send', () => ({ ok: true, data: { message: stored } }));
    await openThread();

    chooseFromLibrary([photo(1)]);

    await screen.findByText('Ready');
    expect(xhr.puts).toHaveLength(1);
    expect(xhr.puts[0]?.url).toBe('https://s3.example.com/put-1');

    fireEvent.press(screen.getByTestId('composer-send'));
    fireEvent.press(screen.getByTestId('composer-send'));

    await waitFor(() => {
      expect(mockFake.emittedEvents('message:send')).toHaveLength(1);
    });
    expect(mockFake.emittedEvents('message:send')[0]).toEqual({
      conversationId: 'c1',
      attachmentIds: ['up1'],
    });
    await screen.findByTestId('message-m10');
    expect(screen.queryByTestId('attachment-drafts')).toBeNull();
  });

  it('disables send while a file is still uploading', async () => {
    jest
      .mocked(api.POST)
      .mockImplementation(((path: string) =>
        path === '/v1/uploads' ? new Promise(() => undefined) : Promise.resolve(ok({}))) as never);
    await openThread();

    chooseFromLibrary([photo(1)]);

    expect(await screen.findByTestId('composer-wait-uploads')).toBeTruthy();
    fireEvent.changeText(screen.getByTestId('composer-input'), 'text');
    expect(isDisabled('composer-send')).toBe(true);
  });

  it('shows a still-scanning state, not an error, when the send is refused with 422', async () => {
    mockFake.respondTo('message:send', () => ({
      ok: false,
      error: {
        code: 'UNPROCESSABLE_ENTITY',
        message: 'An attachment has not finished scanning yet',
      },
    }));
    await openThread();
    chooseFromLibrary([photo(1)]);
    await screen.findByText('Ready');

    fireEvent.press(screen.getByTestId('composer-send'));

    expect(await screen.findByText('Waiting for the file check.')).toBeTruthy();
    expect(
      screen.getByText('An attachment is still being checked. Try again in a moment.'),
    ).toBeTruthy();
    expect(screen.queryByText('Not sent.')).toBeNull();
    expect(
      screen.queryByText('One of the attachments has a problem. Remove it and try again.'),
    ).toBeNull();

    const stored = makeMessage('m11', '2026-10-06T10:00:00.000Z', { senderId: 'me', body: null });
    mockFake.respondTo('message:send', () => ({ ok: true, data: { message: stored } }));
    fireEvent.press(screen.getByText('Retry'));
    await screen.findByTestId('message-m11');
    expect(mockFake.emittedEvents('message:send')[1]).toEqual({
      conversationId: 'c1',
      attachmentIds: ['up1'],
    });
  });

  it('caps a message at 10 attachments', async () => {
    await openThread();

    chooseFromLibrary(Array.from({ length: 11 }, (_, index) => photo(index + 1)));

    expect(await screen.findByText('You can attach up to 10 files to a message.')).toBeTruthy();
    await waitFor(() => {
      expect(screen.getAllByText('Ready')).toHaveLength(10);
    });
    expect(isDisabled('composer-attach')).toBe(true);
  });

  it('rejects a file type the API does not accept', async () => {
    mockGetDocument.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///a.zip', name: 'a.zip', mimeType: 'application/zip' }],
    });
    await openThread();

    fireEvent.press(screen.getByTestId('composer-attach'));
    fireEvent.press(screen.getByTestId('attach-files'));

    expect(
      await screen.findByText("a.zip can't be attached. Use a JPEG, PNG, WebP or PDF file."),
    ).toBeTruthy();
    expect(screen.queryByTestId('attachment-drafts')).toBeNull();
    expect(jest.mocked(api.POST)).not.toHaveBeenCalled();
  });

  it('lets a failed upload be retried or removed', async () => {
    xhr.failNextWith(500);
    await openThread();
    chooseFromLibrary([photo(1)]);

    expect(await screen.findByText('Upload failed.')).toBeTruthy();
    expect(isDisabled('composer-send')).toBe(true);

    xhr.failNextWith(200);
    fireEvent.press(screen.getByText('Retry'));
    await screen.findByText('Ready');
    expect(isDisabled('composer-send')).toBe(false);

    fireEvent.press(screen.getByLabelText('Remove photo-1.jpg'));
    expect(screen.queryByTestId('attachment-drafts')).toBeNull();
  });
});

describe('attachment chip', () => {
  it('does not open a download url that is not https', async () => {
    const openUrl = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    serverMessages = [
      makeMessage('m7', '2026-10-05T09:00:00.000Z', {
        body: null,
        attachments: [{ id: 'a1', kind: 'document', mimeType: 'application/pdf', sizeBytes: 2048 }],
      }),
    ];
    mockedGet.mockImplementation(((path: string) => {
      if (path.endsWith('/download')) {
        return Promise.resolve(ok({ url: 'http://files.example.com/doc.pdf', expiresAt: 'x' }));
      }
      if (path === '/v1/conversations/{id}') {
        return Promise.resolve(ok(conversation));
      }
      return Promise.resolve(ok({ items: serverMessages, nextCursor: null }));
    }) as never);
    await openThread();

    expect(screen.getByText('PDF')).toBeTruthy();
    expect(screen.getByText('2 KB')).toBeTruthy();
    fireEvent.press(screen.getByTestId('attachment-a1'));

    expect(await screen.findByText("Couldn't open this attachment. Try again.")).toBeTruthy();
    expect(openUrl).not.toHaveBeenCalled();
    openUrl.mockRestore();
  });
});
