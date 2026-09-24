import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { components } from '@photoo/api-client';

import { translate } from '@/testing/mock-translations';
import type { VerificationDocumentUploadStage } from '@/lib/verification-document-upload';

vi.mock('next-intl', async () => {
  const { mockUseTranslations } = await import('@/testing/mock-translations');
  return { useTranslations: mockUseTranslations };
});

const uploadVerificationDocumentMock = vi.fn();
vi.mock('@/lib/verification-document-upload', async () => {
  const actual = await vi.importActual<typeof import('@/lib/verification-document-upload')>(
    '@/lib/verification-document-upload',
  );
  return { ...actual, uploadVerificationDocument: uploadVerificationDocumentMock };
});

type RequiredDocument = components['schemas']['RequiredDocument'];
type VerificationDocument = components['schemas']['VerificationDocument'];

const requirement: RequiredDocument = {
  key: 'id_card',
  label: { en: 'Government ID' },
  description: 'A valid passport or national ID card.',
  acceptedMimeTypes: ['application/pdf', 'image/jpeg'],
};

function fakeFile(name: string, type: string): File {
  return new File([new Uint8Array(10)], name, { type });
}

function requiredInput(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) {
    throw new Error('no file input found');
  }
  return input;
}

async function loadComponent() {
  const { VerificationDocumentSlot } = await import('./verification-document-slot');
  return VerificationDocumentSlot;
}

describe('VerificationDocumentSlot', () => {
  afterEach(() => {
    vi.resetModules();
    uploadVerificationDocumentMock.mockReset();
  });

  it('shows the requirement label, description and a missing status when nothing is uploaded', async () => {
    const VerificationDocumentSlot = await loadComponent();
    render(
      <VerificationDocumentSlot
        locale="en"
        requirement={requirement}
        document={null}
        readOnly={false}
        onUploaded={vi.fn()}
      />,
    );

    expect(screen.getByText('Government ID')).toBeInTheDocument();
    expect(screen.getByText('A valid passport or national ID card.')).toBeInTheDocument();
    expect(screen.getByText('Not uploaded')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upload' })).toBeInTheDocument();
  });

  it('shows an uploaded document as clean, with a replace action', async () => {
    const uploaded: VerificationDocument = {
      id: 'doc-1',
      documentKey: 'id_card',
      mimeType: 'application/pdf',
      virusScanStatus: 'clean',
      uploadedAt: '2026-01-01T00:00:00.000Z',
    };
    const VerificationDocumentSlot = await loadComponent();
    render(
      <VerificationDocumentSlot
        locale="en"
        requirement={requirement}
        document={uploaded}
        readOnly={false}
        onUploaded={vi.fn()}
      />,
    );

    expect(screen.getByText('Uploaded')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Replace' })).toBeInTheDocument();
  });

  it('never renders a link or preview for an uploaded document', async () => {
    const uploaded: VerificationDocument = {
      id: 'doc-1',
      documentKey: 'id_card',
      mimeType: 'application/pdf',
      virusScanStatus: 'clean',
      uploadedAt: '2026-01-01T00:00:00.000Z',
    };
    const VerificationDocumentSlot = await loadComponent();
    render(
      <VerificationDocumentSlot
        locale="en"
        requirement={requirement}
        document={uploaded}
        readOnly={false}
        onUploaded={vi.fn()}
      />,
    );

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('hides the upload action entirely when read-only', async () => {
    const VerificationDocumentSlot = await loadComponent();
    render(
      <VerificationDocumentSlot
        locale="en"
        requirement={requirement}
        document={null}
        readOnly
        onUploaded={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Upload' })).not.toBeInTheDocument();
  });

  it('rejects a file type the requirement does not accept, without starting an upload', async () => {
    const VerificationDocumentSlot = await loadComponent();
    render(
      <VerificationDocumentSlot
        locale="en"
        requirement={requirement}
        document={null}
        readOnly={false}
        onUploaded={vi.fn()}
      />,
    );

    fireEvent.change(requiredInput(), { target: { files: [fakeFile('id.gif', 'image/gif')] } });

    expect(
      await screen.findByText("This file type isn't accepted for this document."),
    ).toBeInTheDocument();
    expect(uploadVerificationDocumentMock).not.toHaveBeenCalled();
  });

  it('reflects the shared uploader stages and reports the attached document', async () => {
    let onProgress!: (percent: number) => void;
    let onStageChange!: (stage: VerificationDocumentUploadStage) => void;
    let resolveUpload!: (value: VerificationDocument) => void;
    uploadVerificationDocumentMock.mockImplementation(
      (
        _file: File,
        _documentKey: string,
        handlers: { onProgress: typeof onProgress; onStageChange: typeof onStageChange },
      ) => {
        onProgress = handlers.onProgress;
        onStageChange = handlers.onStageChange;
        return new Promise<VerificationDocument>((resolve) => {
          resolveUpload = resolve;
        });
      },
    );
    const onUploaded = vi.fn();
    const VerificationDocumentSlot = await loadComponent();
    render(
      <VerificationDocumentSlot
        locale="en"
        requirement={requirement}
        document={null}
        readOnly={false}
        onUploaded={onUploaded}
      />,
    );

    fireEvent.change(requiredInput(), {
      target: { files: [fakeFile('id.pdf', 'application/pdf')] },
    });
    expect(uploadVerificationDocumentMock).toHaveBeenCalledWith(
      expect.any(File),
      'id_card',
      expect.anything(),
    );

    onStageChange('uploading');
    onProgress(30);
    expect(await screen.findByText('Uploading… 30%')).toBeInTheDocument();

    onStageChange('scanning');
    expect(await screen.findByText('Scanning for viruses…')).toBeInTheDocument();

    const attached: VerificationDocument = {
      id: 'doc-1',
      documentKey: 'id_card',
      mimeType: 'application/pdf',
      virusScanStatus: 'clean',
      uploadedAt: '2026-01-01T00:00:00.000Z',
    };
    resolveUpload(attached);
    await vi.waitFor(() => {
      expect(onUploaded).toHaveBeenCalledWith(attached);
    });
    // The slot itself doesn't hold document state - it reports the attached
    // document upward and the parent decides what to render for it, the same
    // division of responsibility as `handleDocumentUploaded` in
    // verification-manager.tsx.
    expect(screen.getByText('Not uploaded')).toBeInTheDocument();
  });

  it('shows a translated error when the upload fails a virus scan', async () => {
    const { PresignedUploadError } = await import('@/lib/presigned-upload');
    const { VerificationDocumentUploadError } = await import('@/lib/verification-document-upload');
    uploadVerificationDocumentMock.mockRejectedValue(
      new VerificationDocumentUploadError(
        'infected',
        new PresignedUploadError('infected', 'The file failed the virus scan').message,
      ),
    );
    const VerificationDocumentSlot = await loadComponent();
    render(
      <VerificationDocumentSlot
        locale="en"
        requirement={requirement}
        document={null}
        readOnly={false}
        onUploaded={vi.fn()}
      />,
    );

    fireEvent.change(requiredInput(), {
      target: { files: [fakeFile('id.pdf', 'application/pdf')] },
    });

    expect(
      await screen.findByText(translate('web.dashboard.verification', 'uploadErrors.infected')),
    ).toBeInTheDocument();
  });
});
