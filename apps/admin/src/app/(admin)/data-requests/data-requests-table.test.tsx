import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ADMIN_FORMATS, ADMIN_TIME_ZONE } from '@/lib/datetime';

vi.mock('next-intl', async () => {
  const { mockUseFormatter, mockUseTranslations } = await import('@/testing/mock-translations');
  return { useTranslations: mockUseTranslations, useFormatter: mockUseFormatter };
});

const getMock = vi.fn();
vi.mock('@/lib/api', () => ({ api: { GET: getMock } }));

function formatExpected(iso: string) {
  return new Intl.DateTimeFormat('en', {
    ...ADMIN_FORMATS.dateTime.medium,
    timeZone: ADMIN_TIME_ZONE,
  }).format(new Date(iso));
}

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
  responseDueAt: null,
  answeredLate: false,
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
      `/users/${encodeURIComponent(baseRequest.user.id)}`,
    );
  });

  it('encodes the user id in the user detail link', async () => {
    const withEncodableId = {
      ...baseRequest,
      user: { id: 'a1/a1?a1=1', email: 'alice@example.com' },
    };
    getMock.mockResolvedValueOnce({ data: { items: [withEncodableId], nextCursor: null } });
    const DataRequestsTable = await loadDataRequestsTable();

    render(<DataRequestsTable />);

    expect(await screen.findByRole('link', { name: 'a***@example.com' })).toHaveAttribute(
      'href',
      `/users/${encodeURIComponent(withEncodableId.user.id)}`,
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
    const noCompletedAt = { ...baseRequest, completedAt: null };
    getMock.mockResolvedValueOnce({ data: { items: [noCompletedAt], nextCursor: null } });
    const DataRequestsTable = await loadDataRequestsTable();

    render(<DataRequestsTable />);

    await screen.findByText('a***@example.com');
    expect(screen.getAllByText('None')).toHaveLength(2);
  });

  it('shows the export expiry date', async () => {
    getMock.mockResolvedValueOnce({ data: { items: [baseRequest], nextCursor: null } });
    const DataRequestsTable = await loadDataRequestsTable();

    render(<DataRequestsTable />);

    expect(await screen.findByText(formatExpected(baseRequest.expiresAt))).toBeInTheDocument();
  });

  it('shows a dash for a null expiresAt', async () => {
    const noExpiry = { ...baseRequest, expiresAt: null };
    getMock.mockResolvedValueOnce({ data: { items: [noExpiry], nextCursor: null } });
    const DataRequestsTable = await loadDataRequestsTable();

    render(<DataRequestsTable />);

    await screen.findByText('a***@example.com');
    expect(screen.getByText('–')).toBeInTheDocument();
  });

  it('shows "Ready" for a ready export whose expiry has not passed', async () => {
    const downloadable = {
      ...baseRequest,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    };
    getMock.mockResolvedValueOnce({ data: { items: [downloadable], nextCursor: null } });
    const DataRequestsTable = await loadDataRequestsTable();

    render(<DataRequestsTable />);

    expect(await screen.findByText('Ready')).toBeInTheDocument();
  });

  it('shows "Expired" instead of "Ready" for a ready export past its expiry', async () => {
    const expired = {
      ...baseRequest,
      expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    };
    getMock.mockResolvedValueOnce({ data: { items: [expired], nextCursor: null } });
    const DataRequestsTable = await loadDataRequestsTable();

    render(<DataRequestsTable />);

    expect(await screen.findByText('Expired')).toBeInTheDocument();
    expect(screen.queryByText('Ready')).not.toBeInTheDocument();
  });

  it('shows "Not applicable" for the response due column when responseDueAt is null', async () => {
    const deletion = {
      ...baseRequest,
      type: 'delete' as const,
      status: 'pending' as const,
      completedAt: null,
      requestedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
      responseDueAt: null,
    };
    getMock.mockResolvedValueOnce({ data: { items: [deletion], nextCursor: null } });
    const DataRequestsTable = await loadDataRequestsTable();

    render(<DataRequestsTable />);

    await screen.findByText('a***@example.com');
    expect(screen.getByText('Not applicable')).toBeInTheDocument();
  });

  it('shows a future response due date without marking it overdue', async () => {
    const dueSoon = {
      ...baseRequest,
      status: 'failed' as const,
      responseDueAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    };
    getMock.mockResolvedValueOnce({ data: { items: [dueSoon], nextCursor: null } });
    const DataRequestsTable = await loadDataRequestsTable();

    render(<DataRequestsTable />);

    expect(await screen.findByText(formatExpected(dueSoon.responseDueAt))).toBeInTheDocument();
    expect(screen.queryByText('Overdue')).not.toBeInTheDocument();
  });

  it('marks a past response due date as overdue', async () => {
    const overdueExport = {
      ...baseRequest,
      status: 'failed' as const,
      responseDueAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    };
    getMock.mockResolvedValueOnce({ data: { items: [overdueExport], nextCursor: null } });
    const DataRequestsTable = await loadDataRequestsTable();

    render(<DataRequestsTable />);

    expect(
      await screen.findByText(`${formatExpected(overdueExport.responseDueAt)} (Overdue)`),
    ).toBeInTheDocument();
  });

  it('shows the overdue response due date alongside null completedAt and expiresAt placeholders', async () => {
    const overdueWithNulls = {
      ...baseRequest,
      status: 'failed' as const,
      completedAt: null,
      expiresAt: null,
      responseDueAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    };
    getMock.mockResolvedValueOnce({ data: { items: [overdueWithNulls], nextCursor: null } });
    const DataRequestsTable = await loadDataRequestsTable();

    render(<DataRequestsTable />);

    expect(
      await screen.findByText(`${formatExpected(overdueWithNulls.responseDueAt)} (Overdue)`),
    ).toBeInTheDocument();
    expect(screen.getAllByText('None')).toHaveLength(2);
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

  it('shows "Due now" once the grace period has elapsed but the sweep slack has not', async () => {
    const overdueDeletion = {
      ...baseRequest,
      id: '3fa85f64-5717-4562-b3fc-2c963f66afa9',
      type: 'delete' as const,
      status: 'pending' as const,
      completedAt: null,
      requestedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000 - 60 * 60 * 1000).toISOString(),
    };
    getMock.mockResolvedValueOnce({ data: { items: [overdueDeletion], nextCursor: null } });
    const DataRequestsTable = await loadDataRequestsTable();

    render(<DataRequestsTable />);

    expect(await screen.findByText('Due now')).toBeInTheDocument();
  });

  it('shows "Overdue" once the grace period and the sweep slack have both elapsed', async () => {
    const overdueDeletion = {
      ...baseRequest,
      id: '3fa85f64-5717-4562-b3fc-2c963f66afaa',
      type: 'delete' as const,
      status: 'pending' as const,
      completedAt: null,
      requestedAt: new Date(Date.now() - 32 * 24 * 60 * 60 * 1000).toISOString(),
    };
    getMock.mockResolvedValueOnce({ data: { items: [overdueDeletion], nextCursor: null } });
    const DataRequestsTable = await loadDataRequestsTable();

    render(<DataRequestsTable />);

    expect(await screen.findByText('Overdue')).toBeInTheDocument();
  });

  it('shows "Overdue" for a pending deletion with a failureReason, even before the deadline', async () => {
    const failedDeletion = {
      ...baseRequest,
      id: '3fa85f64-5717-4562-b3fc-2c963f66afab',
      type: 'delete' as const,
      status: 'pending' as const,
      completedAt: null,
      requestedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
      failureReason: 'anonymisation_failed',
    };
    getMock.mockResolvedValueOnce({ data: { items: [failedDeletion], nextCursor: null } });
    const DataRequestsTable = await loadDataRequestsTable();

    render(<DataRequestsTable />);

    expect(await screen.findByText('Overdue')).toBeInTheDocument();
  });

  it('explains the match rules in the empty state', async () => {
    getMock.mockResolvedValueOnce({ data: { items: [], nextCursor: null } });
    const DataRequestsTable = await loadDataRequestsTable();

    render(<DataRequestsTable />);

    expect(await screen.findByText('No data requests match your filters.')).toBeInTheDocument();
  });

  it('does not call the API when the userId filter is invalid', async () => {
    const DataRequestsTable = await loadDataRequestsTable();

    const { container } = render(<DataRequestsTable userId="not-a-uuid" userIdInvalid />);

    expect(container).toBeEmptyDOMElement();
    expect(getMock).not.toHaveBeenCalled();
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
