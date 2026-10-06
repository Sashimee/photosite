import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const serverApiMock = vi.fn();
vi.mock('@/lib/server-api', () => ({ serverApi: serverApiMock }));

const notFoundMock = vi.fn(() => {
  throw new Error('NEXT_NOT_FOUND');
});
vi.mock('next/navigation', () => ({ notFound: notFoundMock }));

vi.mock('next-intl/server', async () => {
  const { mockUseFormatter, translate } = await import('@/testing/mock-translations');
  return {
    getTranslations: (namespace: string) => (key: string, values?: Record<string, unknown>) =>
      translate(namespace, key, values),
    getFormatter: () => mockUseFormatter(),
  };
});

const checkActionsMock = vi.fn(({ checkId }: { checkId: string }) => (
  <div data-testid="check-actions">{checkId}</div>
));
const checkSignalsMock = vi.fn(() => <div data-testid="check-signals" />);
const decisionHistoryMock = vi.fn(({ targetId }: { targetId: string }) => (
  <div data-testid="decision-history">{targetId}</div>
));
vi.mock('./check-actions', () => ({ CheckActions: checkActionsMock }));
vi.mock('./check-signals', () => ({ CheckSignals: checkSignalsMock }));
vi.mock('./decision-history', () => ({ DecisionHistory: decisionHistoryMock }));

async function loadPage() {
  return (await import('./page')).default;
}

const check = {
  id: 'check-1',
  portfolioImageId: 'image-1',
  portfolioImageStatus: 'pending_review' as const,
  thumbnailUrl: 'https://media.example.com/1.jpg',
  photographer: { id: 'p1', displayName: 'Jane Doe', slug: 'jane-doe' },
  verdict: 'review' as const,
  score: 0.42 as number | null,
  checkedAt: '2026-09-20T12:00:00.000Z' as string | null,
  reviewedAt: null as string | null,
  reviewedByAdminId: null as string | null,
  note: null as string | null,
  decisionReason: null as string | null,
  decisionReasonText: null as string | null,
  aiScore: null,
  aiVendor: null,
  reverseMatches: null,
  c2paValid: null,
  exifCamera: null,
  exifCapturedAt: null,
};

function apiWith(checkResult: unknown, auditResult: unknown = ok()) {
  return vi.fn().mockImplementation((path: string) => {
    if (path === '/v1/admin/provenance/{id}') {
      return checkResult;
    }
    if (path === '/v1/admin/audit-log') {
      return auditResult;
    }
    throw new Error(`Unexpected path ${path}`);
  });
}

function ok() {
  return { data: { items: [], nextCursor: null }, response: { status: 200 } };
}

async function renderPage() {
  const Page = await loadPage();
  render(await Page({ params: Promise.resolve({ id: 'check-1' }) }));
}

beforeEach(() => {
  serverApiMock.mockReset();
  notFoundMock.mockClear();
  checkActionsMock.mockClear();
  decisionHistoryMock.mockClear();
});

describe('ProvenanceCheckPage', () => {
  it('renders the check, its status, score and checked date, and wires the child components', async () => {
    serverApiMock.mockResolvedValue({
      GET: apiWith({ data: check, response: { status: 200 } }),
    });

    await renderPage();

    expect(screen.getByRole('heading', { level: 1, name: 'Provenance check' })).toBeInTheDocument();
    expect(screen.getByText('check-1')).toBeInTheDocument();
    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    expect(screen.getByText('jane-doe')).toBeInTheDocument();
    expect(screen.getByText('Pending review')).toBeInTheDocument();
    expect(screen.getByText('Needs review')).toBeInTheDocument();
    expect(screen.getByText('42%')).toBeInTheDocument();
    expect(screen.getByText('Sep 20, 2026, 2:00 PM GMT+2')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Portfolio image by Jane Doe' })).toHaveAttribute(
      'src',
      'https://media.example.com/1.jpg',
    );
    expect(screen.queryByText('Reviewed')).not.toBeInTheDocument();
    expect(screen.queryByText('Decision on record')).not.toBeInTheDocument();
    expect(screen.getByTestId('check-signals')).toBeInTheDocument();
    expect(checkActionsMock.mock.calls[0]?.[0]).toEqual({ checkId: 'check-1' });
  });

  it('renders a null score as not checked, never as 0%', async () => {
    serverApiMock.mockResolvedValue({
      GET: apiWith({
        data: { ...check, score: null, checkedAt: null },
        response: { status: 200 },
      }),
    });

    await renderPage();

    expect(screen.getByText('Not checked (no vendor configured)')).toBeInTheDocument();
    expect(screen.queryByText('0%')).not.toBeInTheDocument();
    expect(screen.queryByText('Checked')).not.toBeInTheDocument();
  });

  it('shows the decision record and reviewer once the check was decided', async () => {
    serverApiMock.mockResolvedValue({
      GET: apiWith({
        data: {
          ...check,
          portfolioImageStatus: 'rejected' as const,
          reviewedAt: '2026-09-21T08:00:00.000Z',
          reviewedByAdminId: 'admin-7',
          note: 'Matches a stock photo',
          decisionReason: 'not_own_work',
          decisionReasonText: 'Image found on a stock site',
        },
        response: { status: 200 },
      }),
    });

    await renderPage();

    expect(screen.getByText('Decision on record')).toBeInTheDocument();
    expect(screen.getByText('Matches a stock photo')).toBeInTheDocument();
    expect(screen.getByText("Not the photographer's own work")).toBeInTheDocument();
    expect(screen.getByText('Image found on a stock site')).toBeInTheDocument();
    expect(screen.getByText('admin-7')).toBeInTheDocument();
    expect(screen.getByText('Sep 21, 2026, 10:00 AM GMT+2')).toBeInTheDocument();
  });

  it('renders the internal note literally, never as HTML', async () => {
    serverApiMock.mockResolvedValue({
      GET: apiWith({
        data: { ...check, note: '<img src=x onerror=alert(1)>' },
        response: { status: 200 },
      }),
    });

    await renderPage();

    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(document.querySelector('img[src="x"]')).not.toBeInTheDocument();
  });

  it('renders the decision history scoped to the check when the audit log is readable', async () => {
    serverApiMock.mockResolvedValue({
      GET: apiWith({ data: check, response: { status: 200 } }),
    });

    await renderPage();

    expect(screen.getByText('Decision history')).toBeInTheDocument();
    expect(screen.getByTestId('decision-history')).toBeInTheDocument();
    expect(decisionHistoryMock.mock.calls[0]?.[0]).toEqual({ targetId: 'check-1' });
  });

  it('hides the history when the audit-log probe is forbidden but keeps the actions', async () => {
    serverApiMock.mockResolvedValue({
      GET: apiWith(
        { data: check, response: { status: 200 } },
        { data: undefined, response: { status: 403 } },
      ),
    });

    await renderPage();

    expect(screen.queryByTestId('decision-history')).not.toBeInTheDocument();
    expect(screen.queryByText('Decision history')).not.toBeInTheDocument();
    expect(screen.getByTestId('check-actions')).toBeInTheDocument();
  });

  it('throws when the audit-log probe fails for any other reason', async () => {
    serverApiMock.mockResolvedValue({
      GET: apiWith(
        { data: check, response: { status: 200 } },
        { data: undefined, response: { status: 500 } },
      ),
    });
    const Page = await loadPage();

    await expect(Page({ params: Promise.resolve({ id: 'check-1' }) })).rejects.toThrow(/HTTP 500/);
  });

  it('calls notFound for a missing check without probing the audit log', async () => {
    const get = apiWith({ data: undefined, response: { status: 404 } });
    serverApiMock.mockResolvedValue({ GET: get });
    const Page = await loadPage();

    await expect(Page({ params: Promise.resolve({ id: 'missing' }) })).rejects.toThrow(
      'NEXT_NOT_FOUND',
    );
    expect(notFoundMock).toHaveBeenCalled();
    expect(get).toHaveBeenCalledTimes(1);
  });

  it.each([403, 500])('throws on an unexpected %i instead of rendering', async (status) => {
    serverApiMock.mockResolvedValue({
      GET: apiWith({ data: undefined, response: { status } }),
    });
    const Page = await loadPage();

    await expect(Page({ params: Promise.resolve({ id: 'check-1' }) })).rejects.toThrow(
      new RegExp(`HTTP ${String(status)}`),
    );
    expect(notFoundMock).not.toHaveBeenCalled();
  });
});
