import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { translate } from '@/testing/mock-translations';

const CONVERSATION_ID = '3fa85f64-5717-4562-b3fc-2c963f66a222';

const getSessionMock = vi.fn();
const apiGetMock = vi.fn();

vi.mock('@/lib/session', () => ({
  getSession: getSessionMock,
  serverApi: vi.fn().mockResolvedValue({ GET: apiGetMock }),
}));
vi.mock('next-intl/server', () => ({
  getTranslations:
    ({ namespace }: { namespace: string }) =>
    (key: string, values?: Record<string, unknown>) =>
      translate(namespace, key, values),
}));
vi.mock('@/components/messages/thread', () => ({
  Thread: (props: { conversationId: string; initialMessages: unknown[] }) => (
    <div data-testid="thread" data-conversation-id={props.conversationId}>
      {props.initialMessages.length} messages
    </div>
  ),
}));

const CONVERSATION = {
  id: CONVERSATION_ID,
  type: 'quote' as const,
  subjectId: 'quote-1',
  subjectRef: null,
  participants: [
    {
      userId: 'client-1',
      user: { id: 'client-1', displayName: null, avatarUrl: null },
      lastReadAt: null,
    },
    {
      userId: 'photographer-1',
      user: { id: 'photographer-1', displayName: 'Jane Doe', avatarUrl: null },
      lastReadAt: null,
    },
  ],
  lastMessageAt: null,
  lastMessagePreview: null,
  unreadCount: 0,
  archivedByMe: false,
};

const MESSAGE = {
  id: 'msg-1',
  conversationId: CONVERSATION_ID,
  senderId: 'photographer-1',
  body: 'Hi',
  attachments: [],
  editedAt: null,
  deletedAt: null,
  createdAt: '2026-01-01T10:00:00.000Z',
};

function mockApi({
  conversation,
  conversationStatus = 200,
  messages = [MESSAGE],
}: {
  conversation?: unknown;
  conversationStatus?: number;
  messages?: unknown[];
}) {
  apiGetMock.mockImplementation((url: string) => {
    if (url === '/v1/conversations/{id}') {
      return Promise.resolve({ data: conversation, response: { status: conversationStatus } });
    }
    if (url === '/v1/conversations/{id}/messages') {
      return Promise.resolve({
        data: { items: messages, nextCursor: null },
        response: { status: 200 },
      });
    }
    throw new Error(`unexpected GET ${url}`);
  });
}

async function loadPage() {
  const mod = await import('./page');
  return mod.default;
}

async function redirectDigest(promise: Promise<unknown>): Promise<string | undefined> {
  const error: unknown = await promise.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(Error);
  return (error as { digest?: string }).digest;
}

describe('ThreadPage', () => {
  afterEach(() => {
    vi.resetModules();
    getSessionMock.mockReset();
    apiGetMock.mockReset();
  });

  it('redirects to sign-in with the sanitised next path when signed out', async () => {
    getSessionMock.mockResolvedValue(null);
    const ThreadPage = await loadPage();

    const digest = await redirectDigest(
      ThreadPage({ params: Promise.resolve({ locale: 'en', conversationId: CONVERSATION_ID }) }),
    );

    expect(digest).toContain(encodeURIComponent(`/en/messages/${CONVERSATION_ID}`));
  });

  it('renders notFound when the conversation id is not a valid identifier', async () => {
    getSessionMock.mockResolvedValue({ id: 'client-1' });
    const ThreadPage = await loadPage();

    const digest = await redirectDigest(
      ThreadPage({ params: Promise.resolve({ locale: 'en', conversationId: 'not-a-uuid' }) }),
    );

    expect(digest).toMatch(/;404$/);
    expect(apiGetMock).not.toHaveBeenCalled();
  });

  it('renders notFound when the caller is not a participant', async () => {
    getSessionMock.mockResolvedValue({ id: 'client-1' });
    mockApi({ conversationStatus: 404 });
    const ThreadPage = await loadPage();

    const digest = await redirectDigest(
      ThreadPage({ params: Promise.resolve({ locale: 'en', conversationId: CONVERSATION_ID }) }),
    );

    expect(digest).toMatch(/;404$/);
  });

  it('redirects to sign-in when the session expires between the check and the fetch', async () => {
    getSessionMock.mockResolvedValue({ id: 'client-1' });
    mockApi({ conversationStatus: 401 });
    const ThreadPage = await loadPage();

    const digest = await redirectDigest(
      ThreadPage({ params: Promise.resolve({ locale: 'en', conversationId: CONVERSATION_ID }) }),
    );

    expect(digest).toContain(encodeURIComponent(`/en/messages/${CONVERSATION_ID}`));
  });

  it('throws loudly when the API call fails unexpectedly', async () => {
    getSessionMock.mockResolvedValue({ id: 'client-1' });
    mockApi({ conversationStatus: 500 });
    const ThreadPage = await loadPage();

    await expect(
      ThreadPage({ params: Promise.resolve({ locale: 'en', conversationId: CONVERSATION_ID }) }),
    ).rejects.toThrow(/HTTP 500/);
  });

  it('renders the thread with the server-fetched first page', async () => {
    getSessionMock.mockResolvedValue({ id: 'client-1' });
    mockApi({ conversation: CONVERSATION });
    const ThreadPage = await loadPage();

    const element = await ThreadPage({
      params: Promise.resolve({ locale: 'en', conversationId: CONVERSATION_ID }),
    });
    render(element);

    expect(
      screen.getByRole('link', { name: translate('web.messages.thread', 'backToList') }),
    ).toHaveAttribute('href', '/en/messages');
    const thread = screen.getByTestId('thread');
    expect(thread).toHaveAttribute('data-conversation-id', CONVERSATION_ID);
    expect(thread).toHaveTextContent('1 messages');
  });
});
