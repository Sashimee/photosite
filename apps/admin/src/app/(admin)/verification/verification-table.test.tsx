import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next-intl', async () => {
  const { mockUseFormatter, mockUseTranslations } = await import('@/testing/mock-translations');
  return { useTranslations: mockUseTranslations, useFormatter: mockUseFormatter };
});

const getMock = vi.fn();
vi.mock('@/lib/api', () => ({ api: { GET: getMock } }));

// See suspend-dialog.test.tsx: a static import of the component under test
// would resolve '@/lib/api' - and read `getMock` - before the `const
// getMock` above is initialized.
async function loadVerificationTable() {
  return (await import('./verification-table')).VerificationTable;
}

const baseCase = {
  id: 'case-1',
  countryCode: 'LU',
  status: 'submitted' as const,
  documents: [],
  submittedAt: '2026-09-01T00:00:00.000Z',
  decidedAt: null,
  rejectionReason: null,
  userId: 'user-1',
  assignedAdminId: null,
  decidedByAdminId: null,
  photographer: { displayName: 'Alice Photography', email: 'alice@example.com' },
};

describe('VerificationTable', () => {
  it('requests the queue with the default submitted status, relying on the API for oldest-first order', async () => {
    getMock.mockResolvedValueOnce({ data: { items: [baseCase], nextCursor: null } });
    const VerificationTable = await loadVerificationTable();

    render(<VerificationTable status="submitted" currentAdminId="admin-1" />);
    await screen.findByText('Alice Photography');

    expect(getMock).toHaveBeenCalledWith('/v1/admin/verification-cases', {
      params: { query: { status: 'submitted' } },
    });
  });

  it('forwards the country filter and cursor on every page', async () => {
    getMock.mockResolvedValueOnce({ data: { items: [baseCase], nextCursor: null } });
    const VerificationTable = await loadVerificationTable();

    render(<VerificationTable status="in_review" countryCode="LU" currentAdminId="admin-1" />);
    await screen.findByText('Alice Photography');

    expect(getMock).toHaveBeenCalledWith('/v1/admin/verification-cases', {
      params: { query: { status: 'in_review', countryCode: 'LU' } },
    });
  });

  it('shows the formatted submittedAt date', async () => {
    getMock.mockResolvedValueOnce({ data: { items: [baseCase], nextCursor: null } });
    const VerificationTable = await loadVerificationTable();

    render(<VerificationTable status="submitted" currentAdminId="admin-1" />);

    expect(await screen.findByText('Sep 1, 2026, 2:00 AM GMT+2')).toBeInTheDocument();
  });

  it('leaves the submittedAt cell blank when the case has not been submitted', async () => {
    getMock.mockResolvedValueOnce({
      data: { items: [{ ...baseCase, submittedAt: null }], nextCursor: null },
    });
    const VerificationTable = await loadVerificationTable();

    render(<VerificationTable status="submitted" currentAdminId="admin-1" />);
    const row = await screen.findByText('Alice Photography');
    const tableRow = row.closest('tr');
    if (!tableRow) {
      throw new Error('expected the photographer link to be rendered inside a table row');
    }
    const cells = within(tableRow).getAllByRole('cell');
    const headers = screen.getAllByRole('columnheader');
    const submittedAtIndex = headers.findIndex((header) => header.textContent === 'Submitted');
    expect(submittedAtIndex).toBeGreaterThan(-1);

    expect(cells[submittedAtIndex]).toHaveTextContent('');
  });

  it('shows unclaimed for a case with no assigned admin', async () => {
    getMock.mockResolvedValueOnce({ data: { items: [baseCase], nextCursor: null } });
    const VerificationTable = await loadVerificationTable();

    render(<VerificationTable status="submitted" currentAdminId="admin-1" />);

    expect(await screen.findByText('Unclaimed')).toBeInTheDocument();
  });

  it('shows "You" when the current admin is the assigned reviewer', async () => {
    getMock.mockResolvedValueOnce({
      data: {
        items: [{ ...baseCase, status: 'in_review', assignedAdminId: 'admin-1' }],
        nextCursor: null,
      },
    });
    const VerificationTable = await loadVerificationTable();

    render(<VerificationTable status="in_review" currentAdminId="admin-1" />);

    expect(await screen.findByText('You')).toBeInTheDocument();
  });

  it('names another admin as the reviewer when assigned to someone else', async () => {
    getMock.mockResolvedValueOnce({
      data: {
        items: [{ ...baseCase, status: 'in_review', assignedAdminId: 'admin-2' }],
        nextCursor: null,
      },
    });
    const VerificationTable = await loadVerificationTable();

    render(<VerificationTable status="in_review" currentAdminId="admin-1" />);

    expect(await screen.findByText('Claimed by admin-2')).toBeInTheDocument();
  });
});
