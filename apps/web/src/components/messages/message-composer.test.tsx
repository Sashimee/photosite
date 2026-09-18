import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { translate } from '@/testing/mock-translations';

vi.mock('next-intl', async () => {
  const { mockUseTranslations } = await import('@/testing/mock-translations');
  return { useTranslations: mockUseTranslations };
});
vi.mock('./attachment-picker', () => ({
  AttachmentPicker: ({
    onChange,
  }: {
    onChange: (
      attachments: { uploadId: string; mimeType: string; sizeBytes: number }[],
      busy: boolean,
    ) => void;
  }) => (
    <div>
      <button
        type="button"
        onClick={() => {
          onChange([], true);
        }}
      >
        make-busy
      </button>
      <button
        type="button"
        onClick={() => {
          onChange([{ uploadId: 'u1', mimeType: 'image/png', sizeBytes: 10 }], false);
        }}
      >
        make-ready
      </button>
    </div>
  ),
}));

async function loadComposer() {
  const { MessageComposer } = await import('./message-composer');
  return MessageComposer;
}

describe('MessageComposer', () => {
  afterEach(() => {
    vi.resetModules();
  });

  it('sends the trimmed body and clears the field on success', async () => {
    const onSend = vi.fn().mockResolvedValue({ ok: true });
    const onTyping = vi.fn();
    const MessageComposer = await loadComposer();
    const user = userEvent.setup();

    render(<MessageComposer onSend={onSend} onTyping={onTyping} />);
    await user.type(
      screen.getByLabelText(translate('web.messages.composer', 'bodyLabel')),
      '  hello  ',
    );
    await user.click(
      screen.getByRole('button', { name: translate('web.messages.composer', 'sendCta') }),
    );

    expect(onSend).toHaveBeenCalledWith({ body: 'hello', attachments: [] });
    expect(screen.getByLabelText(translate('web.messages.composer', 'bodyLabel'))).toHaveValue('');
  });

  it('notifies typing while the field has content, and stops on send', async () => {
    const onSend = vi.fn().mockResolvedValue({ ok: true });
    const onTyping = vi.fn();
    const MessageComposer = await loadComposer();
    const user = userEvent.setup();

    render(<MessageComposer onSend={onSend} onTyping={onTyping} />);
    await user.type(screen.getByLabelText(translate('web.messages.composer', 'bodyLabel')), 'h');
    expect(onTyping).toHaveBeenCalledWith(true);

    await user.click(
      screen.getByRole('button', { name: translate('web.messages.composer', 'sendCta') }),
    );
    expect(onTyping).toHaveBeenLastCalledWith(false);
  });

  it('disables send while an attachment is still uploading', async () => {
    const onSend = vi.fn().mockResolvedValue({ ok: true });
    const MessageComposer = await loadComposer();
    const user = userEvent.setup();

    render(<MessageComposer onSend={onSend} onTyping={() => undefined} />);
    await user.click(screen.getByRole('button', { name: 'make-busy' }));

    expect(
      screen.getByRole('button', { name: translate('web.messages.composer', 'sendCta') }),
    ).toBeDisabled();
    expect(
      screen.getByText(translate('web.messages.composer', 'uploadingHint')),
    ).toBeInTheDocument();
  });

  it('allows sending attachments alone once ready, with no body', async () => {
    const onSend = vi.fn().mockResolvedValue({ ok: true });
    const MessageComposer = await loadComposer();
    const user = userEvent.setup();

    render(<MessageComposer onSend={onSend} onTyping={() => undefined} />);
    await user.click(screen.getByRole('button', { name: 'make-ready' }));
    await user.click(
      screen.getByRole('button', { name: translate('web.messages.composer', 'sendCta') }),
    );

    expect(onSend).toHaveBeenCalledWith({
      body: undefined,
      attachments: [{ uploadId: 'u1', mimeType: 'image/png', sizeBytes: 10 }],
    });
  });

  it('shows a mapped error and keeps the body when sending fails', async () => {
    const onSend = vi.fn().mockResolvedValue({ ok: false, error: { code: 'NOT_FOUND' } });
    const MessageComposer = await loadComposer();
    const user = userEvent.setup();

    render(<MessageComposer onSend={onSend} onTyping={() => undefined} />);
    await user.type(
      screen.getByLabelText(translate('web.messages.composer', 'bodyLabel')),
      'hello',
    );
    await user.click(
      screen.getByRole('button', { name: translate('web.messages.composer', 'sendCta') }),
    );

    expect(
      await screen.findByText(translate('web.messages', 'errors.notFound')),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(translate('web.messages.composer', 'bodyLabel'))).toHaveValue(
      'hello',
    );
  });

  it('sends on Enter and inserts a newline on Shift+Enter', async () => {
    const onSend = vi.fn().mockResolvedValue({ ok: true });
    const MessageComposer = await loadComposer();
    const user = userEvent.setup();

    render(<MessageComposer onSend={onSend} onTyping={() => undefined} />);
    const field = screen.getByLabelText(translate('web.messages.composer', 'bodyLabel'));
    await user.type(field, 'line one{Shift>}{Enter}{/Shift}line two');
    expect(onSend).not.toHaveBeenCalled();
    expect(field).toHaveValue('line one\nline two');

    await user.type(field, '{Enter}');
    expect(onSend).toHaveBeenCalledWith({ body: 'line one\nline two', attachments: [] });
  });

  it('disables send when both the body and attachments are empty', async () => {
    const onSend = vi.fn();
    const MessageComposer = await loadComposer();

    render(<MessageComposer onSend={onSend} onTyping={() => undefined} />);
    expect(
      screen.getByRole('button', { name: translate('web.messages.composer', 'sendCta') }),
    ).toBeDisabled();
  });
});
