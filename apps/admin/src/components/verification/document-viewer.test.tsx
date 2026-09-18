import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next-intl', async () => {
  const { mockUseTranslations } = await import('@/testing/mock-translations');
  return { useTranslations: mockUseTranslations };
});

const getMock = vi.fn();
vi.mock('@/lib/api', () => ({ api: { GET: getMock } }));

// See suspend-dialog.test.tsx in apps/admin/src/app/(admin)/users/[id]: a
// static import of the component under test would resolve '@/lib/api' -
// and read `getMock` - before the `const getMock` above is initialized.
async function loadDocumentViewer() {
  return (await import('./document-viewer')).DocumentViewer;
}

const baseDocument = {
  id: 'doc-1',
  documentKey: 'id_card',
  mimeType: 'image/jpeg',
  virusScanStatus: 'clean' as const,
  uploadedAt: '2026-09-01T00:00:00.000Z',
};

const fetchMock = vi.fn();
const createObjectUrlMock = vi.fn(() => 'blob:mock-object-url');
const revokeObjectUrlMock = vi.fn();

function stubBrowserApis() {
  vi.stubGlobal('fetch', fetchMock);
  URL.createObjectURL = createObjectUrlMock;
  URL.revokeObjectURL = revokeObjectUrlMock;
}

describe('DocumentViewer', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
    createObjectUrlMock.mockClear();
    revokeObjectUrlMock.mockClear();
    getMock.mockReset();
  });

  it('never requests the document URL before the viewer is opened', async () => {
    stubBrowserApis();
    const DocumentViewer = await loadDocumentViewer();

    render(<DocumentViewer caseId="case-1" document={baseDocument} />);

    expect(getMock).not.toHaveBeenCalled();
    expect(document.body.innerHTML).not.toContain('downloadUrl');
  });

  it('fetches the case detail only once the reviewer clicks view, then renders the image', async () => {
    stubBrowserApis();
    getMock.mockResolvedValueOnce({
      data: {
        documents: [{ ...baseDocument, downloadUrl: 'https://storage.example.com/doc-1' }],
      },
    });
    fetchMock.mockResolvedValueOnce({ ok: true, blob: () => Promise.resolve(new Blob()) });
    const DocumentViewer = await loadDocumentViewer();
    const events = userEvent.setup();

    render(<DocumentViewer caseId="case-1" document={baseDocument} />);
    expect(getMock).not.toHaveBeenCalled();

    await events.click(screen.getByRole('button', { name: 'View' }));

    await waitFor(() => {
      expect(getMock).toHaveBeenCalledWith('/v1/admin/verification-cases/{id}', {
        params: { path: { id: 'case-1' } },
      });
    });
    expect(fetchMock).toHaveBeenCalledWith('https://storage.example.com/doc-1', {
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
    });
    const image = await screen.findByAltText('Preview of the id_card document');
    expect(image).toHaveAttribute('src', 'blob:mock-object-url');
    expect(image).toHaveAttribute('referrerPolicy', 'no-referrer');
  });

  it('shows the scanning state, not a broken viewer, when the document has no download URL yet', async () => {
    stubBrowserApis();
    getMock.mockResolvedValueOnce({ data: { documents: [baseDocument] } });
    const DocumentViewer = await loadDocumentViewer();
    const events = userEvent.setup();

    render(<DocumentViewer caseId="case-1" document={baseDocument} />);
    await events.click(screen.getByRole('button', { name: 'View' }));

    expect(
      await screen.findByText(
        'This document is still being scanned for viruses. Check back shortly.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('renders a PDF in an iframe sandboxed without allow-same-origin', async () => {
    stubBrowserApis();
    const pdfDocument = { ...baseDocument, mimeType: 'application/pdf' };
    getMock.mockResolvedValueOnce({
      data: { documents: [{ ...pdfDocument, downloadUrl: 'https://storage.example.com/doc-1' }] },
    });
    fetchMock.mockResolvedValueOnce({ ok: true, blob: () => Promise.resolve(new Blob()) });
    const DocumentViewer = await loadDocumentViewer();
    const events = userEvent.setup();

    render(<DocumentViewer caseId="case-1" document={pdfDocument} />);
    await events.click(screen.getByRole('button', { name: 'View' }));

    const frame = await screen.findByTitle('id_card');
    expect(frame.tagName).toBe('IFRAME');
    expect(frame).toHaveAttribute('sandbox', '');
    expect(frame.getAttribute('sandbox')).not.toContain('allow-same-origin');
    expect(frame).toHaveAttribute('referrerPolicy', 'no-referrer');
  });

  it('revokes the object URL on close', async () => {
    stubBrowserApis();
    getMock.mockResolvedValueOnce({
      data: {
        documents: [{ ...baseDocument, downloadUrl: 'https://storage.example.com/doc-1' }],
      },
    });
    fetchMock.mockResolvedValueOnce({ ok: true, blob: () => Promise.resolve(new Blob()) });
    const DocumentViewer = await loadDocumentViewer();
    const events = userEvent.setup();

    render(<DocumentViewer caseId="case-1" document={baseDocument} />);
    await events.click(screen.getByRole('button', { name: 'View' }));
    await screen.findByAltText('Preview of the id_card document');

    await events.keyboard('{Escape}');

    await waitFor(() => {
      expect(revokeObjectUrlMock).toHaveBeenCalledWith('blob:mock-object-url');
    });
  });

  it('never sets a download attribute or an external link on the viewer', async () => {
    stubBrowserApis();
    getMock.mockResolvedValueOnce({
      data: {
        documents: [{ ...baseDocument, downloadUrl: 'https://storage.example.com/doc-1' }],
      },
    });
    fetchMock.mockResolvedValueOnce({ ok: true, blob: () => Promise.resolve(new Blob()) });
    const DocumentViewer = await loadDocumentViewer();
    const events = userEvent.setup();

    render(<DocumentViewer caseId="case-1" document={baseDocument} />);
    await events.click(screen.getByRole('button', { name: 'View' }));
    await screen.findByAltText('Preview of the id_card document');

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(document.querySelector('[download]')).toBeNull();
    expect(document.querySelector('a[target="_blank"]')).toBeNull();
  });
});
