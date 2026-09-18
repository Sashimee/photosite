import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { translate } from '@/testing/mock-translations';

vi.mock('next-intl', async () => {
  const { mockUseTranslations } = await import('@/testing/mock-translations');
  return { useTranslations: mockUseTranslations };
});
vi.mock('@/lib/chat-socket', () => ({
  useChatSocket: () => ({
    connected: false,
    socket: {
      connected: false,
      on: () => undefined,
      off: () => undefined,
      emit: () => undefined,
      timeout: () => ({ emitWithAck: () => Promise.resolve({ ok: true, data: {} }) }),
    },
  }),
}));

async function loadThread() {
  const { Thread } = await import('./thread');
  return Thread;
}

const conversation = {
  id: 'conv-1',
  type: 'quote' as const,
  subjectId: 'quote-1',
  subjectRef: null,
  participants: [
    { userId: 'me', user: { id: 'me', displayName: null, avatarUrl: null }, lastReadAt: null },
    {
      userId: 'client-1',
      user: { id: 'client-1', displayName: null, avatarUrl: null },
      lastReadAt: null,
    },
  ],
  lastMessageAt: null,
  lastMessagePreview: null,
  unreadCount: 0,
  archivedByMe: false,
};

function msg(id: string, senderId: string, body: string, createdAt: string) {
  return {
    id,
    conversationId: 'conv-1',
    senderId,
    body,
    attachments: [],
    editedAt: null,
    deletedAt: null,
    createdAt,
  };
}

describe('Thread', () => {
  it('renders the server-rendered messages before any socket connects', async () => {
    const Thread = await loadThread();

    render(
      <Thread
        conversationId="conv-1"
        currentUserId="me"
        initialMessages={[
          msg('m1', 'client-1', 'Hi there', '2026-01-01T10:00:00.000Z'),
          msg('m2', 'me', 'Hello!', '2026-01-01T10:01:00.000Z'),
        ]}
        initialNextCursor={null}
        initialConversation={conversation}
        locale="en"
        clientLabel="Client"
      />,
    );

    expect(screen.getByText('Hi there')).toBeInTheDocument();
    expect(screen.getByText('Hello!')).toBeInTheDocument();
  });

  it('labels a nameless participant by role instead of by email or id', async () => {
    const Thread = await loadThread();

    render(
      <Thread
        conversationId="conv-1"
        currentUserId="me"
        initialMessages={[msg('m1', 'client-1', 'Hi there', '2026-01-01T10:00:00.000Z')]}
        initialNextCursor={null}
        initialConversation={conversation}
        locale="en"
        clientLabel="Client"
      />,
    );

    expect(screen.getByText('Client')).toBeInTheDocument();
    expect(screen.queryByText('client-1')).not.toBeInTheDocument();
  });

  it('hides the load-older control when there is no older page', async () => {
    const Thread = await loadThread();

    render(
      <Thread
        conversationId="conv-1"
        currentUserId="me"
        initialMessages={[]}
        initialNextCursor={null}
        initialConversation={conversation}
        locale="en"
        clientLabel="Client"
      />,
    );
    expect(
      screen.queryByRole('button', { name: translate('web.messages.thread', 'loadOlderCta') }),
    ).not.toBeInTheDocument();
  });

  it('shows a load-older control when an older page exists', async () => {
    const Thread = await loadThread();

    render(
      <Thread
        conversationId="conv-1"
        currentUserId="me"
        initialMessages={[]}
        initialNextCursor="cursor-1"
        initialConversation={conversation}
        locale="en"
        clientLabel="Client"
      />,
    );
    expect(
      screen.getByRole('button', { name: translate('web.messages.thread', 'loadOlderCta') }),
    ).toBeInTheDocument();
  });
});
