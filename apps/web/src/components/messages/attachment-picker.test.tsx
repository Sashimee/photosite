import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { translate } from '@/testing/mock-translations';

const uploadMock = vi.fn();
vi.mock('@/lib/chat-attachments', () => ({
  uploadChatAttachment: uploadMock,
  ChatAttachmentError: class ChatAttachmentError extends Error {},
}));
vi.mock('next-intl', async () => {
  const { mockUseTranslations } = await import('@/testing/mock-translations');
  return { useTranslations: mockUseTranslations };
});

function fakeFile(name: string, type: string, size = 100): File {
  return new File([new Uint8Array(size)], name, { type });
}

function getFileInput(): HTMLInputElement {
  const input = document.querySelector('input[type="file"]');
  if (!(input instanceof HTMLInputElement)) {
    throw new Error('file input not found');
  }
  return input;
}

async function loadPicker() {
  const { AttachmentPicker } = await import('./attachment-picker');
  return AttachmentPicker;
}

describe('AttachmentPicker', () => {
  afterEach(() => {
    vi.resetModules();
    uploadMock.mockReset();
  });

  it('uploads a selected file, reports progress, and reports it ready once done', async () => {
    let resolveUpload: ((value: { uploadId: string }) => void) | undefined;
    uploadMock.mockImplementation(
      (_file: File, onProgress: (percent: number) => void) =>
        new Promise((resolve) => {
          onProgress(40);
          resolveUpload = resolve;
        }),
    );
    const AttachmentPicker = await loadPicker();
    const onChange = vi.fn();
    const user = userEvent.setup();

    render(<AttachmentPicker onChange={onChange} resetKey={0} />);
    const input = getFileInput();
    await user.upload(input, fakeFile('a.png', 'image/png'));

    expect(await screen.findByText('40%')).toBeInTheDocument();
    expect(onChange).toHaveBeenLastCalledWith([], true);

    resolveUpload?.({ uploadId: 'upload-1' });
    await waitFor(() => {
      expect(onChange).toHaveBeenLastCalledWith(
        [{ uploadId: 'upload-1', mimeType: 'image/png', sizeBytes: 100 }],
        false,
      );
    });
  });

  it('rejects a file of an unsupported type', async () => {
    const AttachmentPicker = await loadPicker();
    const onChange = vi.fn();
    // The `accept` attribute already keeps this out of the native file
    // picker; `applyAccept: false` exercises the component's own check,
    // which still matters against drag-and-drop or a renamed extension.
    const user = userEvent.setup({ applyAccept: false });

    render(<AttachmentPicker onChange={onChange} resetKey={0} />);
    const input = getFileInput();
    await user.upload(input, fakeFile('a.txt', 'text/plain'));

    expect(
      screen.getByText(translate('web.messages.attachments', 'unsupportedType')),
    ).toBeInTheDocument();
    expect(uploadMock).not.toHaveBeenCalled();
    expect(onChange).toHaveBeenLastCalledWith([], false);
  });

  it('caps the number of files at the maximum per message', async () => {
    uploadMock.mockImplementation(() => new Promise(() => undefined));
    const AttachmentPicker = await loadPicker();
    const onChange = vi.fn();
    const user = userEvent.setup();

    render(<AttachmentPicker onChange={onChange} resetKey={0} />);
    const input = getFileInput();
    const files = Array.from({ length: 11 }, (_, index) =>
      fakeFile(`f${String(index)}.png`, 'image/png'),
    );
    await user.upload(input, files);

    expect(
      screen.getByText(translate('web.messages.attachments', 'tooManyFiles', { max: 10 })),
    ).toBeInTheDocument();
    expect(uploadMock).toHaveBeenCalledTimes(10);
  });

  it('shows an error chip when the upload rejects', async () => {
    uploadMock.mockRejectedValue(new Error('boom'));
    const AttachmentPicker = await loadPicker();
    const onChange = vi.fn();
    const user = userEvent.setup();

    render(<AttachmentPicker onChange={onChange} resetKey={0} />);
    const input = getFileInput();
    await user.upload(input, fakeFile('a.png', 'image/png'));

    expect(
      await screen.findByText(translate('web.messages.attachments', 'uploadFailed')),
    ).toBeInTheDocument();
    expect(onChange).toHaveBeenLastCalledWith([], false);
  });

  it('clears every file once resetKey changes', async () => {
    uploadMock.mockResolvedValue({ uploadId: 'upload-1' });
    const AttachmentPicker = await loadPicker();
    const onChange = vi.fn();
    const user = userEvent.setup();

    const { rerender } = render(<AttachmentPicker onChange={onChange} resetKey={0} />);
    const input = getFileInput();
    await user.upload(input, fakeFile('a.png', 'image/png'));
    await waitFor(() => {
      expect(onChange).toHaveBeenLastCalledWith(
        [{ uploadId: 'upload-1', mimeType: 'image/png', sizeBytes: 100 }],
        false,
      );
    });

    rerender(<AttachmentPicker onChange={onChange} resetKey={1} />);
    expect(onChange).toHaveBeenLastCalledWith([], false);
  });
});
