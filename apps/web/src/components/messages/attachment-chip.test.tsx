import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { translate } from '@/testing/mock-translations';

const getMock = vi.fn();
vi.mock('@/lib/api', () => ({ api: { GET: getMock } }));
vi.mock('next-intl', async () => {
  const { mockUseTranslations } = await import('@/testing/mock-translations');
  return { useTranslations: mockUseTranslations };
});

const imageAttachment = {
  id: 'attachment-1',
  kind: 'image' as const,
  mimeType: 'image/png',
  sizeBytes: 2048,
};

const pdfAttachment = {
  id: 'attachment-2',
  kind: 'pdf' as const,
  mimeType: 'application/pdf',
  sizeBytes: 10240,
};

async function loadAttachmentChip() {
  const { AttachmentChip } = await import('./attachment-chip');
  return AttachmentChip;
}

describe('AttachmentChip', () => {
  afterEach(() => {
    vi.resetModules();
    getMock.mockReset();
  });

  it('fetches a fresh presigned URL on click and previews an image inline', async () => {
    getMock.mockResolvedValue({
      data: { url: 'https://storage.example/fresh', expiresAt: '2026-01-01T00:00:00.000Z' },
    });
    const AttachmentChip = await loadAttachmentChip();
    const user = userEvent.setup();

    render(
      <AttachmentChip attachment={imageAttachment} conversationId="conv-1" messageId="msg-1" />,
    );
    await user.click(screen.getByRole('button', { name: /2 KB/ }));

    expect(getMock).toHaveBeenCalledWith(
      '/v1/conversations/{id}/messages/{messageId}/attachments/{attachmentId}/download',
      { params: { path: { id: 'conv-1', messageId: 'msg-1', attachmentId: 'attachment-1' } } },
    );
    const image = await screen.findByAltText(translate('web.messages.attachments', 'imageAlt'));
    expect(image).toHaveAttribute('src', 'https://storage.example/fresh');
  });

  it('opens a new tab for a non-image attachment instead of previewing inline', async () => {
    getMock.mockResolvedValue({
      data: { url: 'https://storage.example/doc', expiresAt: '2026-01-01T00:00:00.000Z' },
    });
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    const AttachmentChip = await loadAttachmentChip();
    const user = userEvent.setup();

    render(<AttachmentChip attachment={pdfAttachment} conversationId="conv-1" messageId="msg-1" />);
    await user.click(screen.getByRole('button', { name: /10 KB/ }));

    expect(openSpy).toHaveBeenCalledWith(
      'https://storage.example/doc',
      '_blank',
      'noopener,noreferrer',
    );
  });

  it('shows an error when the download URL cannot be fetched', async () => {
    getMock.mockResolvedValue({ data: undefined, error: { code: 'CONFLICT' } });
    const AttachmentChip = await loadAttachmentChip();
    const user = userEvent.setup();

    render(
      <AttachmentChip attachment={imageAttachment} conversationId="conv-1" messageId="msg-1" />,
    );
    await user.click(screen.getByRole('button', { name: /2 KB/ }));

    expect(
      await screen.findByText(translate('web.messages.attachments', 'openFailed')),
    ).toBeInTheDocument();
  });
});
