import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next-intl', async () => {
  const { mockUseTranslations } = await import('@/testing/mock-translations');
  return { useTranslations: mockUseTranslations };
});

const getMock = vi.fn();
vi.mock('@/lib/api', () => ({ api: { GET: getMock } }));

const createObjectURL = vi.fn(() => 'blob:csv');
const revokeObjectURL = vi.fn();
const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {
  return undefined;
});

function csvResponse(body: string, disposition: string | null) {
  return {
    data: new Blob([body], { type: 'text/csv' }),
    response: {
      ok: true,
      status: 200,
      headers: new Headers(disposition ? { 'Content-Disposition': disposition } : {}),
    },
  };
}

function failure(code: string, status: number, details?: unknown) {
  return {
    error: { code, details },
    response: { ok: false, status, headers: new Headers() },
  };
}

async function renderButton(filters: Record<string, unknown> = {}) {
  const { ExportButton } = await import('./export-button');
  const events = userEvent.setup();
  render(<ExportButton {...filters} />);
  return events;
}

const exportButton = () => screen.getByRole('button', { name: /Export CSV|Exporting/ });

beforeEach(() => {
  getMock.mockReset();
  createObjectURL.mockClear();
  revokeObjectURL.mockClear();
  clickSpy.mockClear();
  URL.createObjectURL = createObjectURL;
  URL.revokeObjectURL = revokeObjectURL;
});

describe('ExportButton', () => {
  it('warns about the second factor and the limit before the click', async () => {
    await renderButton();

    expect(screen.getByText(/asks for your second factor again/)).toBeInTheDocument();
    expect(screen.getByText(/limit of 5/)).toBeInTheDocument();
    expect(getMock).not.toHaveBeenCalled();
  });

  it('requests exactly the active filters as a blob', async () => {
    getMock.mockResolvedValueOnce(csvResponse('id\n', null));
    const filters = {
      status: ['released', 'disputed'],
      createdFrom: '2026-01-01',
      createdTo: '2026-02-01',
      dispute: 'open',
    };
    const events = await renderButton(filters);

    await events.click(exportButton());

    await waitFor(() => {
      expect(getMock).toHaveBeenCalledExactlyOnceWith('/v1/admin/bookings/export.csv', {
        params: { query: filters },
        parseAs: 'blob',
      });
    });
  });

  it('sends no query values when no filter is active', async () => {
    getMock.mockResolvedValueOnce(csvResponse('id\n', null));
    const events = await renderButton();

    await events.click(exportButton());

    await waitFor(() => {
      expect(getMock).toHaveBeenCalledWith(
        '/v1/admin/bookings/export.csv',
        expect.objectContaining({ params: { query: {} } }),
      );
    });
  });

  it('downloads the file under the header filename', async () => {
    getMock.mockResolvedValueOnce(
      csvResponse(
        '"id"\n"b1"\n',
        'attachment; filename="photoo-bookings-2026-01-01-2026-02-01.csv"',
      ),
    );
    const events = await renderButton();

    await events.click(exportButton());

    await waitFor(() => {
      expect(clickSpy).toHaveBeenCalledTimes(1);
    });
    const link = clickSpy.mock.contexts[0] as HTMLAnchorElement;
    expect(link.download).toBe('photoo-bookings-2026-01-01-2026-02-01.csv');
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:csv');
    expect(screen.queryByText(/50,000-row cap/)).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it.each([null, 'attachment', 'attachment; filename="../../etc/passwd"'])(
    'falls back to photoo-bookings.csv for the header %s',
    async (disposition) => {
      getMock.mockResolvedValueOnce(csvResponse('id\n', disposition));
      const events = await renderButton();

      await events.click(exportButton());

      await waitFor(() => {
        expect(clickSpy).toHaveBeenCalledTimes(1);
      });
      expect((clickSpy.mock.contexts[0] as HTMLAnchorElement).download).toBe('photoo-bookings.csv');
    },
  );

  it('saves the file and shows the cap notice when it ends with #truncated', async () => {
    getMock.mockResolvedValueOnce(csvResponse('"id"\n"b1"\n#truncated\n', null));
    const events = await renderButton();

    await events.click(exportButton());

    expect(await screen.findByText(/50,000-row cap/)).toBeInTheDocument();
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it('does not show the cap notice when #truncated is only inside a cell', async () => {
    getMock.mockResolvedValueOnce(csvResponse('"id"\n"#truncated"\n"b1"\n', null));
    const events = await renderButton();

    await events.click(exportButton());

    await waitFor(() => {
      expect(clickSpy).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByText(/50,000-row cap/)).not.toBeInTheDocument();
  });

  it('disables the button while the download is in flight', async () => {
    let resolve: (value: unknown) => void = () => undefined;
    getMock.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const events = await renderButton();

    await events.click(exportButton());

    expect(screen.getByRole('button', { name: 'Exporting...' })).toBeDisabled();
    await events.click(screen.getByRole('button', { name: 'Exporting...' }));
    expect(getMock).toHaveBeenCalledTimes(1);

    resolve(csvResponse('id\n', null));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Export CSV' })).toBeEnabled();
    });
  });

  it('includes the retry time on a 429', async () => {
    getMock.mockResolvedValueOnce(failure('TOO_MANY_REQUESTS', 429, { retryAfterSeconds: 540 }));
    const events = await renderButton();

    await events.click(exportButton());

    expect(await screen.findByRole('alert')).toHaveTextContent('Try again in 540 seconds');
    expect(clickSpy).not.toHaveBeenCalled();
  });

  it('shows a plain 429 message without a retry time', async () => {
    getMock.mockResolvedValueOnce(failure('TOO_MANY_REQUESTS', 429));
    const events = await renderButton();

    await events.click(exportButton());

    expect(await screen.findByRole('alert')).toHaveTextContent(/Try again later/);
  });

  it('shows no error text when the second factor is stale', async () => {
    getMock.mockResolvedValueOnce(failure('TWO_FACTOR_REQUIRED', 403));
    const events = await renderButton();

    await events.click(exportButton());

    await waitFor(() => {
      expect(exportButton()).toBeEnabled();
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(clickSpy).not.toHaveBeenCalled();
  });

  it.each([
    ['FORBIDDEN', 403, /don't have permission/],
    ['VALIDATION_ERROR', 400, /can't be exported/],
    ['INTERNAL', 500, /export failed/],
  ])('maps %s to its own message', async (code, status, message) => {
    getMock.mockResolvedValueOnce(failure(code, status));
    const events = await renderButton();

    await events.click(exportButton());

    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(clickSpy).not.toHaveBeenCalled();
  });

  it('saves nothing when the stream is cut mid-download', async () => {
    getMock.mockRejectedValueOnce(new TypeError('network error'));
    const events = await renderButton();

    await events.click(exportButton());

    expect(await screen.findByRole('alert')).toHaveTextContent(/export failed/);
    expect(clickSpy).not.toHaveBeenCalled();
  });
});
