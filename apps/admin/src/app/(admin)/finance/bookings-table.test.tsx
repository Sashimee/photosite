import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next-intl', async () => {
  const { mockUseFormatter, mockUseTranslations } = await import('@/testing/mock-translations');
  return { useTranslations: mockUseTranslations, useFormatter: mockUseFormatter };
});

const getMock = vi.fn();
vi.mock('@/lib/api', () => ({ api: { GET: getMock } }));

async function loadBookingsTable() {
  return (await import('./bookings-table')).BookingsTable;
}

function booking(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    status: 'released',
    total: { amountCents: 12000, currency: 'EUR' },
    refundedCents: 0,
    reversedCents: 0,
    disputeStatus: null,
    releasedAt: '2026-09-20T12:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  getMock.mockReset();
});

describe('BookingsTable', () => {
  it('lists id, status, money, dispute and release time with a link to the detail', async () => {
    getMock.mockResolvedValueOnce({
      data: {
        items: [
          booking('b1', { refundedCents: 2500, reversedCents: 1000, disputeStatus: 'open' }),
          booking('b2', { status: 'paid_held', releasedAt: null }),
        ],
        nextCursor: null,
      },
    });
    const BookingsTable = await loadBookingsTable();

    render(<BookingsTable />);

    const link = await screen.findByRole('link', { name: 'b1' });
    expect(link).toHaveAttribute('href', '/finance/b1');
    const row = link.closest('tr');
    expect(row).not.toBeNull();
    const cells = within(row as HTMLElement);
    expect(cells.getByText('Released')).toBeInTheDocument();
    expect(cells.getByText('€120.00')).toBeInTheDocument();
    expect(cells.getByText('€25.00')).toBeInTheDocument();
    expect(cells.getByText('€10.00')).toBeInTheDocument();
    expect(cells.getByText('Open')).toBeInTheDocument();
    expect(screen.getByText('Paid, held')).toBeInTheDocument();
    expect(screen.getByText('None')).toBeInTheDocument();
  });

  it('requests the first page without a cursor and follows nextCursor', async () => {
    getMock
      .mockResolvedValueOnce({ data: { items: [booking('b1')], nextCursor: 'cur-1' } })
      .mockResolvedValueOnce({ data: { items: [booking('b2')], nextCursor: null } });
    const BookingsTable = await loadBookingsTable();
    const events = userEvent.setup();

    render(<BookingsTable />);
    await screen.findByRole('link', { name: 'b1' });
    expect(getMock).toHaveBeenNthCalledWith(1, '/v1/admin/bookings', { params: { query: {} } });

    await events.click(screen.getByRole('button', { name: /next/i }));

    await screen.findByRole('link', { name: 'b2' });
    expect(getMock).toHaveBeenNthCalledWith(2, '/v1/admin/bookings', {
      params: { query: { cursor: 'cur-1' } },
    });
  });

  it('shows the empty state', async () => {
    getMock.mockResolvedValueOnce({ data: { items: [], nextCursor: null } });
    const BookingsTable = await loadBookingsTable();

    render(<BookingsTable />);

    expect(await screen.findByText('No bookings yet.')).toBeInTheDocument();
  });
});
