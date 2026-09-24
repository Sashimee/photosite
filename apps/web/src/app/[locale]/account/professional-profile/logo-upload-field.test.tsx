import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PresignedUploadStage, ScannedUpload } from '@/lib/presigned-upload';

vi.mock('next-intl', async () => {
  const { mockUseTranslations } = await import('@/testing/mock-translations');
  return { useTranslations: mockUseTranslations };
});

vi.mock('next/image', () => ({
  // eslint-disable-next-line @next/next/no-img-element -- test double, not shipped code
  default: (props: { alt: string; src: string }) => <img alt={props.alt} src={props.src} />,
}));

const uploadAndScanFileMock = vi.fn();
vi.mock('@/lib/presigned-upload', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/presigned-upload')>('@/lib/presigned-upload');
  return { ...actual, uploadAndScanFile: uploadAndScanFileMock };
});

function requiredInput(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) {
    throw new Error('no file input found');
  }
  return input;
}

function fakeFile(name: string, type: string, size = 10): File {
  return new File([new Uint8Array(size)], name, { type });
}

async function loadComponent() {
  const { LogoUploadField } = await import('./logo-upload-field');
  return LogoUploadField;
}

describe('LogoUploadField', () => {
  afterEach(() => {
    vi.resetModules();
    uploadAndScanFileMock.mockReset();
  });

  it('shows the existing logo and offers to replace it', async () => {
    const LogoUploadField = await loadComponent();
    render(
      <LogoUploadField
        logoUrl="https://cdn.example/logo.png"
        companyName="Acme"
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByAltText('Acme logo')).toHaveAttribute('src', 'https://cdn.example/logo.png');
    expect(screen.getByRole('button', { name: 'Replace logo' })).toBeInTheDocument();
  });

  it('shows the empty state and no remove action when there is no logo yet', async () => {
    const onChange = vi.fn();
    const LogoUploadField = await loadComponent();
    render(<LogoUploadField logoUrl={null} companyName="Acme" onChange={onChange} />);

    expect(screen.getByText('No logo yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upload logo' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove logo' })).not.toBeInTheDocument();
  });

  it('rejects an unsupported file type client-side without starting an upload', async () => {
    const onChange = vi.fn();
    const LogoUploadField = await loadComponent();
    render(<LogoUploadField logoUrl={null} companyName="Acme" onChange={onChange} />);

    fireEvent.change(requiredInput(), {
      target: { files: [fakeFile('logo.pdf', 'application/pdf')] },
    });

    expect(screen.getByText('Only JPEG, PNG and WEBP images can be uploaded.')).toBeInTheDocument();
    expect(uploadAndScanFileMock).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('reflects the shared uploader stages and reports the finished upload id', async () => {
    let onProgress!: (percent: number) => void;
    let onStageChange!: (stage: PresignedUploadStage) => void;
    let resolveUpload!: (value: ScannedUpload) => void;
    uploadAndScanFileMock.mockImplementation(
      (
        _file: File,
        _purpose: string,
        handlers: { onProgress: typeof onProgress; onStageChange: typeof onStageChange },
      ) => {
        onProgress = handlers.onProgress;
        onStageChange = handlers.onStageChange;
        return new Promise<ScannedUpload>((resolve) => {
          resolveUpload = resolve;
        });
      },
    );
    const onChange = vi.fn();
    const LogoUploadField = await loadComponent();
    render(<LogoUploadField logoUrl={null} companyName="Acme" onChange={onChange} />);

    fireEvent.change(requiredInput(), { target: { files: [fakeFile('logo.jpg', 'image/jpeg')] } });
    expect(uploadAndScanFileMock).toHaveBeenCalledWith(expect.any(File), 'logo', expect.anything());

    onStageChange('uploading');
    onProgress(42);
    expect(await screen.findByText('Uploading… 42%')).toBeInTheDocument();

    onStageChange('scanning');
    expect(await screen.findByText('Scanning for viruses…')).toBeInTheDocument();

    resolveUpload({ id: 'upload-1', status: 'clean' });
    expect(await screen.findByText('New logo ready. Save to apply it.')).toBeInTheDocument();
    expect(onChange).toHaveBeenCalledWith('upload-1');
  });

  it('shows a translated error when the upload is rejected', async () => {
    const { PresignedUploadError } = await import('@/lib/presigned-upload');
    uploadAndScanFileMock.mockRejectedValue(
      new PresignedUploadError('infected', 'The file failed the virus scan'),
    );
    const onChange = vi.fn();
    const LogoUploadField = await loadComponent();
    render(<LogoUploadField logoUrl={null} companyName="Acme" onChange={onChange} />);

    fireEvent.change(requiredInput(), { target: { files: [fakeFile('logo.jpg', 'image/jpeg')] } });

    expect(
      await screen.findByText("This file failed a virus scan and wasn't uploaded."),
    ).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('lets the user remove an existing logo, reporting a null upload id', async () => {
    const onChange = vi.fn();
    const LogoUploadField = await loadComponent();
    const user = userEvent.setup();

    render(
      <LogoUploadField
        logoUrl="https://cdn.example/logo.png"
        companyName="Acme"
        onChange={onChange}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Remove logo' }));

    expect(screen.getByText('Logo will be removed')).toBeInTheDocument();
    expect(screen.queryByAltText('Acme logo')).not.toBeInTheDocument();
    expect(onChange).toHaveBeenCalledWith(null);
  });
});
