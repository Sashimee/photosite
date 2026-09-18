import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { translate } from '@/testing/mock-translations';

vi.mock('next-intl', async () => {
  const { mockUseTranslations } = await import('@/testing/mock-translations');
  return { useTranslations: mockUseTranslations };
});
vi.mock('./attachment-chip', () => ({
  AttachmentChip: ({ attachment }: { attachment: { id: string } }) => (
    <span data-testid={`attachment-${attachment.id}`} />
  ),
}));

async function loadBubble() {
  const { MessageBubble } = await import('./message-bubble');
  return MessageBubble;
}

const baseMessage = {
  id: 'm1',
  conversationId: 'conv-1',
  senderId: 'user-1',
  body: 'Hello there',
  attachments: [],
  editedAt: null,
  deletedAt: null,
  createdAt: '2026-01-01T10:00:00.000Z',
};

describe('MessageBubble', () => {
  it('renders the body as plain text', async () => {
    const MessageBubble = await loadBubble();
    render(
      <MessageBubble
        kind="sent"
        message={baseMessage}
        conversationId="conv-1"
        isOwn
        showSender={false}
        senderLabel="Me"
        locale="en"
      />,
    );
    expect(screen.getByText('Hello there')).toBeInTheDocument();
  });

  it('renders attachments for a sent message', async () => {
    const MessageBubble = await loadBubble();
    render(
      <MessageBubble
        kind="sent"
        message={{
          ...baseMessage,
          attachments: [{ id: 'att-1', kind: 'image', mimeType: 'image/png', sizeBytes: 100 }],
        }}
        conversationId="conv-1"
        isOwn={false}
        showSender
        senderLabel="Jane Doe"
        locale="en"
      />,
    );
    expect(screen.getByTestId('attachment-att-1')).toBeInTheDocument();
    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
  });

  it('renders a deleted message as deleted, with no body or attachments', async () => {
    const MessageBubble = await loadBubble();
    render(
      <MessageBubble
        kind="sent"
        message={{
          ...baseMessage,
          body: null,
          deletedAt: '2026-01-01T10:05:00.000Z',
          attachments: [{ id: 'att-1', kind: 'image', mimeType: 'image/png', sizeBytes: 100 }],
        }}
        conversationId="conv-1"
        isOwn
        showSender={false}
        senderLabel="Me"
        locale="en"
      />,
    );
    expect(
      screen.getByText(translate('web.messages.thread', 'deletedMessage')),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('attachment-att-1')).not.toBeInTheDocument();
  });

  it('shows a sending status for a pending message', async () => {
    const MessageBubble = await loadBubble();
    render(
      <MessageBubble
        kind="pending"
        pending={{
          localId: 'p1',
          body: 'hi',
          status: 'sending',
          createdAt: '2026-01-01T10:00:00.000Z',
        }}
        onRetry={() => undefined}
        isOwn
        showSender={false}
        senderLabel="Me"
        locale="en"
      />,
    );
    expect(screen.getByText(translate('web.messages.thread', 'sendingStatus'))).toBeInTheDocument();
  });

  it('shows a failed status with a retry action', async () => {
    const MessageBubble = await loadBubble();
    const onRetry = vi.fn();
    const user = userEvent.setup();
    render(
      <MessageBubble
        kind="pending"
        pending={{
          localId: 'p1',
          body: 'hi',
          status: 'failed',
          createdAt: '2026-01-01T10:00:00.000Z',
        }}
        onRetry={onRetry}
        isOwn
        showSender={false}
        senderLabel="Me"
        locale="en"
      />,
    );
    expect(screen.getByText(translate('web.messages.thread', 'failedStatus'))).toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: translate('web.messages.thread', 'retryCta') }),
    );
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
