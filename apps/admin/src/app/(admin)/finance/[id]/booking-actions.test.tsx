import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next-intl', async () => {
  const { mockUseFormatter, mockUseTranslations } = await import('@/testing/mock-translations');
  return { useTranslations: mockUseTranslations, useFormatter: mockUseFormatter };
});

const refreshMock = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: refreshMock }) }));

const postMock = vi.fn();
vi.mock('@/lib/api', () => ({ api: { POST: postMock } }));

async function renderActions(status: string, transferId: string | null = 'tr_1') {
  const { BookingActions } = await import('./booking-actions');
  render(
    <BookingActions
      bookingId="booking-1"
      status={status}
      transferId={transferId}
      currency="EUR"
      refundableCents={12000}
    />,
  );
}

beforeEach(() => {
  postMock.mockReset();
  refreshMock.mockReset();
});

describe('BookingActions', () => {
  it('offers refund and reverse for a released booking', async () => {
    await renderActions('released');

    expect(screen.getByRole('button', { name: 'Refund after release' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reverse transfer' })).toBeInTheDocument();
  });

  it('offers only reverse for a disputed booking with a transfer', async () => {
    await renderActions('disputed', 'tr_1');

    expect(screen.queryByRole('button', { name: 'Refund after release' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reverse transfer' })).toBeInTheDocument();
  });

  it('shows a disputed booking that was already released as reverse-only, never refund', async () => {
    await renderActions('disputed', 'tr_released');

    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Reverse transfer' })).toBeInTheDocument();
    expect(screen.queryByText(/only available for released bookings/)).not.toBeInTheDocument();
  });

  it.each([
    ['disputed', null],
    ['pending_payment', null],
    ['paid_held', 'tr_1'],
    ['in_progress', 'tr_1'],
    ['delivered', 'tr_1'],
    ['refunded', 'tr_1'],
    ['cancelled', null],
  ])('offers no action for %s (transfer %s)', async (status, transferId) => {
    await renderActions(status, transferId);

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText(/only available for released bookings/)).toBeInTheDocument();
  });

  it('refreshes the page and confirms after a successful refund', async () => {
    postMock.mockResolvedValueOnce({ data: { id: 'booking-1' } });
    await renderActions('released');
    const events = userEvent.setup();

    await events.click(screen.getByRole('button', { name: 'Refund after release' }));
    await events.type(screen.getByLabelText(/^Amount/), '10');
    await events.type(screen.getByLabelText(/^Internal reason/), 'x');
    await events.click(screen.getByRole('button', { name: 'Refund' }));

    expect(await screen.findByText(/Refund submitted/)).toBeInTheDocument();
    await waitFor(() => {
      expect(refreshMock).toHaveBeenCalledTimes(1);
    });
  });
});
