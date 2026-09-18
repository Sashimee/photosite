import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { translate } from '@/testing/mock-translations';

vi.mock('next-intl/server', () => ({
  getTranslations:
    ({ namespace }: { namespace: string }) =>
    (key: string, values?: Record<string, unknown>) =>
      translate(namespace, key, values),
}));

async function loadList() {
  const { ConversationList } = await import('./conversation-list');
  return ConversationList;
}

function conversation(
  overrides: {
    id?: string;
    otherDisplayName?: string | null;
    unreadCount?: number;
    lastMessagePreview?: string | null;
    lastMessageAt?: string | null;
    subjectRef?: { type: 'quote'; quoteId: string; requestTitle?: string } | null;
  } = {},
) {
  return {
    id: overrides.id ?? 'conv-1',
    type: 'quote' as const,
    subjectId: 'quote-1',
    subjectRef: overrides.subjectRef ?? null,
    participants: [
      { userId: 'me', user: { id: 'me', displayName: null, avatarUrl: null }, lastReadAt: null },
      {
        userId: 'them',
        user: { id: 'them', displayName: overrides.otherDisplayName ?? null, avatarUrl: null },
        lastReadAt: null,
      },
    ],
    lastMessageAt: overrides.lastMessageAt ?? null,
    lastMessagePreview: overrides.lastMessagePreview ?? null,
    unreadCount: overrides.unreadCount ?? 0,
    archivedByMe: false,
  };
}

describe('ConversationList', () => {
  it('renders the other participant by display name when present', async () => {
    const ConversationList = await loadList();
    render(
      await ConversationList({
        conversations: [conversation({ otherDisplayName: 'Jane Doe' })],
        currentUserId: 'me',
        locale: 'en',
      }),
    );
    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
  });

  it('labels a nameless participant by role instead of by email or id', async () => {
    const ConversationList = await loadList();
    render(
      await ConversationList({
        conversations: [conversation({ otherDisplayName: null })],
        currentUserId: 'me',
        locale: 'en',
      }),
    );
    expect(
      screen.getByText(translate('web.messages.participant', 'clientLabel')),
    ).toBeInTheDocument();
    expect(screen.queryByText('them')).not.toBeInTheDocument();
  });

  it('shows the subject line for a quote conversation', async () => {
    const ConversationList = await loadList();
    render(
      await ConversationList({
        conversations: [
          conversation({
            subjectRef: { type: 'quote', quoteId: 'q1', requestTitle: 'Wedding shoot' },
          }),
        ],
        currentUserId: 'me',
        locale: 'en',
      }),
    );
    expect(
      screen.getByText(translate('web.messages.list', 'subjectQuote', { title: 'Wedding shoot' })),
    ).toBeInTheDocument();
  });

  it('shows an unread badge when there are unread messages', async () => {
    const ConversationList = await loadList();
    render(
      await ConversationList({
        conversations: [conversation({ unreadCount: 3 })],
        currentUserId: 'me',
        locale: 'en',
      }),
    );
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('falls back to a placeholder when there is no last message yet', async () => {
    const ConversationList = await loadList();
    render(
      await ConversationList({
        conversations: [conversation({ lastMessagePreview: null })],
        currentUserId: 'me',
        locale: 'en',
      }),
    );
    expect(screen.getByText(translate('web.messages.list', 'noMessagesYet'))).toBeInTheDocument();
  });
});
