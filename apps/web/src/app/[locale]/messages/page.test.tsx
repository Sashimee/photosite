import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { translate } from '@/testing/mock-translations';

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

const CONVERSATION = {
  id: 'conv-1',
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
  lastMessageAt: '2026-01-01T10:00:00.000Z',
  lastMessagePreview: 'See you then!',
  unreadCount: 1,
  archivedByMe: false,
};

function mockApi({ items, nextCursor = null }: { items: unknown[]; nextCursor?: string | null }) {
  apiGetMock.mockImplementation((url: string) => {
    if (url === '/v1/conversations') {
      return Promise.resolve({ data: { items, nextCursor }, response: { status: 200 } });
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

describe('MessagesListPage', () => {
  afterEach(() => {
    vi.resetModules();
    getSessionMock.mockReset();
    apiGetMock.mockReset();
  });

  it('redirects to sign-in with the sanitised next path when signed out', async () => {
    getSessionMock.mockResolvedValue(null);
    const MessagesListPage = await loadPage();

    const digest = await redirectDigest(
      MessagesListPage({
        params: Promise.resolve({ locale: 'en' }),
        searchParams: Promise.resolve({}),
      }),
    );

    expect(digest).toContain(encodeURIComponent('/en/messages'));
  });

  it('redirects to sign-in when the session expires between the check and the fetch', async () => {
    getSessionMock.mockResolvedValue({ id: 'client-1' });
    apiGetMock.mockResolvedValue({ data: undefined, response: { status: 401 } });
    const MessagesListPage = await loadPage();

    const digest = await redirectDigest(
      MessagesListPage({
        params: Promise.resolve({ locale: 'en' }),
        searchParams: Promise.resolve({}),
      }),
    );

    expect(digest).toContain(encodeURIComponent('/en/messages'));
  });

  it('throws loudly when the API call fails unexpectedly', async () => {
    getSessionMock.mockResolvedValue({ id: 'client-1' });
    apiGetMock.mockResolvedValue({ data: undefined, response: { status: 500 } });
    const MessagesListPage = await loadPage();

    await expect(
      MessagesListPage({
        params: Promise.resolve({ locale: 'en' }),
        searchParams: Promise.resolve({}),
      }),
    ).rejects.toThrow(/HTTP 500/);
  });

  it('renders the empty state when there are no conversations', async () => {
    getSessionMock.mockResolvedValue({ id: 'client-1' });
    mockApi({ items: [] });
    const MessagesListPage = await loadPage();

    const element = await MessagesListPage({
      params: Promise.resolve({ locale: 'en' }),
      searchParams: Promise.resolve({}),
    });
    render(element);

    expect(screen.getByText(translate('web.messages.list', 'empty'))).toBeInTheDocument();
  });

  it('passes the fetched conversations to ConversationList and shows a next-page link', async () => {
    getSessionMock.mockResolvedValue({ id: 'client-1' });
    mockApi({ items: [CONVERSATION], nextCursor: 'cursor-2' });
    const MessagesListPage = await loadPage();
    const { ConversationList } = await import('@/components/messages/conversation-list');

    const element = await MessagesListPage({
      params: Promise.resolve({ locale: 'en' }),
      searchParams: Promise.resolve({}),
    });
    const children = (element.props as { children: unknown[] }).children;
    const list = children[2] as {
      type: unknown;
      props: { conversations: unknown[]; currentUserId: string };
    };
    expect(list.type).toBe(ConversationList);
    expect(list.props.conversations).toEqual([CONVERSATION]);
    expect(list.props.currentUserId).toBe('client-1');

    const nextPage = children[3] as { props: { href: string; children: string } };
    expect(nextPage.props.href).toBe('/en/messages?cursor=cursor-2');
  });

  it('requests archived conversations and shows the archived empty state', async () => {
    getSessionMock.mockResolvedValue({ id: 'client-1' });
    mockApi({ items: [] });
    const MessagesListPage = await loadPage();

    const element = await MessagesListPage({
      params: Promise.resolve({ locale: 'en' }),
      searchParams: Promise.resolve({ archived: 'true' }),
    });
    render(element);

    expect(apiGetMock).toHaveBeenCalledWith(
      '/v1/conversations',
      expect.objectContaining({ params: { query: { limit: 20, archived: 'true' } } }),
    );
    expect(screen.getByText(translate('web.messages.list', 'emptyArchived'))).toBeInTheDocument();
  });
});
