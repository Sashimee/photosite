import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next-intl', async () => {
  const { mockUseTranslations } = await import('@/testing/mock-translations');
  return { useTranslations: mockUseTranslations };
});

const getMock = vi.fn();
vi.mock('@/lib/api', () => ({ api: { GET: getMock } }));

// See suspend-dialog.test.tsx: a static import of the component under test
// would resolve '@/lib/api' - and read `getMock` - before the `const
// getMock` above is initialized.
async function loadDataRequestsTable() {
  return (await import('./data-requests-table')).DataRequestsTable;
}

const baseRequest = {
  id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  type: 'export' as const,
  status: 'ready' as const,
  requestedAt: '2026-09-01T12:00:00.000Z',
  completedAt: '2026-09-02T12:00:00.000Z',
  expiresAt: '2026-09-09T12:00:00.000Z',
  failureReason: null,
  cancelledAt: null,
  user: { id: 'a1a1a1a1-1111-1111-1111-111111111111', email: 'alice@example.com' },
};

describe('DataRequestsTable', () => {
  it('masks the user email and links it to the user detail page', async () => {
    getMock.mockResolvedValueOnce({ data: { items: [baseRequest], nextCursor: null } });
    const DataRequestsTable = await loadDataRequestsTable();

    render(<DataRequestsTable />);

    expect(await screen.findByText('a***@example.com')).toBeInTheDocument();
    expect(screen.queryByText('alice@example.com')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'a***@example.com' })).toHaveAttribute(
      'href',
      `/users/${baseRequest.user.id}`,
    );
  });

  it('renders an anonymised user row as-is', async () => {
    const anonymised = {
      ...baseRequest,
      id: '3fa85f64-5717-4562-b3fc-2c963f66afa7',
      type: 'delete' as const,
      status: 'completed' as const,
      user: { id: 'b2b2b2b2-2222-2222-2222-222222222222', email: 'deleted-b2b2@deleted.invalid' },
    };
    getMock.mockResolvedValueOnce({ data: { items: [anonymised], nextCursor: null } });
    const DataRequestsTable = await loadDataRequestsTable();

    render(<DataRequestsTable />);

    expect(await screen.findByText('d***@deleted.invalid')).toBeInTheDocument();
  });

  it('shows placeholders for a null completedAt and failureReason', async () => {
    getMock.mockResolvedValueOnce({ data: { items: [baseRequest], nextCursor: null } });
    const DataRequestsTable = await loadDataRequestsTable();

    render(<DataRequestsTable />);

    await screen.findByText('a***@example.com');
    expect(screen.getAllByText('None').length).toBeGreaterThanOrEqual(1);
  });

  it('shows the export expiry date', async () => {
    getMock.mockResolvedValueOnce({ data: { items: [baseRequest], nextCursor: null } });
    const DataRequestsTable = await loadDataRequestsTable();

    render(<DataRequestsTable />);

    expect(await screen.findByText(baseRequest.expiresAt)).toBeInTheDocument();
  });

  it('shows a dash for a null expiresAt', async () => {
    const noExpiry = { ...baseRequest, expiresAt: null };
    getMock.mockResolvedValueOnce({ data: { items: [noExpiry], nextCursor: null } });
    const DataRequestsTable = await loadDataRequestsTable();

    render(<DataRequestsTable />);

    await screen.findByText('a***@example.com');
    expect(screen.getByText('–')).toBeInTheDocument();
  });

  it('shows the grace period countdown only for a pending deletion', async () => {
    const pendingDeletion = {
      ...baseRequest,
      id: '3fa85f64-5717-4562-b3fc-2c963f66afa8',
      type: 'delete' as const,
      status: 'pending' as const,
      completedAt: null,
      requestedAt: new Date(Date.now() - 29 * 24 * 60 * 60 * 1000).toISOString(),
    };
    getMock.mockResolvedValueOnce({ data: { items: [pendingDeletion], nextCursor: null } });
    const DataRequestsTable = await loadDataRequestsTable();

    render(<DataRequestsTable />);

    expect(await screen.findByText('1 day left')).toBeInTheDocument();
  });

  it('shows "Due now" once the grace period has elapsed', async () => {
    const overdueDeletion = {
      ...baseRequest,
      id: '3fa85f64-5717-4562-b3fc-2c963f66afa9',
      type: 'delete' as const,
      status: 'pending' as const,
      completedAt: null,
      requestedAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString(),
    };
    getMock.mockResolvedValueOnce({ data: { items: [overdueDeletion], nextCursor: null } });
    const DataRequestsTable = await loadDataRequestsTable();

    render(<DataRequestsTable />);

    expect(await screen.findByText('Due now')).toBeInTheDocument();
  });

  it('explains the match rules in the empty state', async () => {
    getMock.mockResolvedValueOnce({ data: { items: [], nextCursor: null } });
    const DataRequestsTable = await loadDataRequestsTable();

    render(<DataRequestsTable />);

    expect(await screen.findByText('No data requests match your filters.')).toBeInTheDocument();
  });

  it('forwards the filters and cursor to the API on every page', async () => {
    getMock.mockResolvedValueOnce({
      data: { items: [baseRequest], nextCursor: 'page-2' },
    });
    getMock.mockResolvedValueOnce({ data: { items: [], nextCursor: null } });
    const DataRequestsTable = await loadDataRequestsTable();

    render(<DataRequestsTable status="ready" type="export" userId={baseRequest.user.id} />);
    await screen.findByText('a***@example.com');

    expect(getMock).toHaveBeenNthCalledWith(1, '/v1/admin/data-requests', {
      params: {
        query: { status: 'ready', type: 'export', userId: baseRequest.user.id },
      },
    });

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Next' }));

    expect(getMock).toHaveBeenNthCalledWith(2, '/v1/admin/data-requests', {
      params: {
        query: {
          status: 'ready',
          type: 'export',
          userId: baseRequest.user.id,
          cursor: 'page-2',
        },
      },
    });
  });
});
