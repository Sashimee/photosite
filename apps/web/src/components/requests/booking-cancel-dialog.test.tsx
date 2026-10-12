import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { translate } from '@/testing/mock-translations';

import type { Booking } from './booking-card';

const apiPostMock = vi.fn();
const routerRefreshMock = vi.fn();

vi.mock('@/lib/api', () => ({ api: { POST: apiPostMock } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: routerRefreshMock }) }));
vi.mock('next-intl', async () => {
  const { mockUseTranslations } = await import('@/testing/mock-translations');
  const cache = new Map<string, ReturnType<typeof mockUseTranslations>>();
  return {
    useTranslations: (namespace: string) => {
      const cached = cache.get(namespace);
      if (cached) {
        return cached;
      }
      const translator = mockUseTranslations(namespace);
      cache.set(namespace, translator);
      return translator;
    },
  };
});

const BOOKING_ID = '3fa85f64-5717-4562-b3fc-2c963f66afa6';
const baseBooking: Booking = {
  id: BOOKING_ID,
  quoteId: '3fa85f64-5717-4562-b3fc-2c963f66aaaa',
  clientId: '3fa85f64-5717-4562-b3fc-2c963f66cccc',
  photographerId: '3fa85f64-5717-4562-b3fc-2c963f66dddd',
  total: { amountCents: 157500, currency: 'EUR' },
  scheduledAt: '2026-12-01T10:00:00.000Z',
  location: { lat: 49.6116, lng: 6.1319 },
  status: 'pending_payment',
  releaseDueAt: null,
  deliveredAt: null,
  releasedAt: null,
  cancelledAt: null,
  cancellationReason: null,
};

async function loadBookingCancelDialog() {
  const { BookingCancelDialog } = await import('./booking-cancel-dialog');
  return BookingCancelDialog;
}

describe('BookingCancelDialog', () => {
  afterEach(() => {
    apiPostMock.mockReset();
    routerRefreshMock.mockReset();
  });

  it.each([
    'paid_held',
    'in_progress',
    'delivered',
    'released',
    'cancelled',
    'refunded',
    'disputed',
  ] as const)('renders nothing when the booking is %s', async (status) => {
    const BookingCancelDialog = await loadBookingCancelDialog();
    const { container } = render(<BookingCancelDialog booking={{ ...baseBooking, status }} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('submits without a reason when left blank and refreshes on success', async () => {
    apiPostMock.mockResolvedValue({ data: {}, error: undefined });
    const BookingCancelDialog = await loadBookingCancelDialog();
    const user = userEvent.setup();

    render(<BookingCancelDialog booking={baseBooking} />);

    await user.click(
      screen.getByRole('button', { name: translate('web.bookings.detail.cancel', 'cta') }),
    );
    await user.click(
      screen.getByRole('button', { name: translate('web.bookings.detail.cancel', 'confirmCta') }),
    );

    expect(apiPostMock).toHaveBeenCalledWith('/v1/bookings/{id}/cancel', {
      params: { path: { id: BOOKING_ID } },
      body: {},
    });
    expect(routerRefreshMock).toHaveBeenCalledTimes(1);
  });

  it('submits the trimmed reason when provided', async () => {
    apiPostMock.mockResolvedValue({ data: {}, error: undefined });
    const BookingCancelDialog = await loadBookingCancelDialog();
    const user = userEvent.setup();

    render(<BookingCancelDialog booking={baseBooking} />);

    await user.click(
      screen.getByRole('button', { name: translate('web.bookings.detail.cancel', 'cta') }),
    );
    await user.type(
      screen.getByLabelText(translate('web.bookings.detail.cancel', 'reasonLabel')),
      '  Schedule conflict  ',
    );
    await user.click(
      screen.getByRole('button', { name: translate('web.bookings.detail.cancel', 'confirmCta') }),
    );

    expect(apiPostMock).toHaveBeenCalledWith('/v1/bookings/{id}/cancel', {
      params: { path: { id: BOOKING_ID } },
      body: { reason: 'Schedule conflict' },
    });
    expect(routerRefreshMock).toHaveBeenCalledTimes(1);
  });

  it('shows a mapped error and does not refresh when the request is rejected as a conflict', async () => {
    apiPostMock.mockResolvedValue({ data: undefined, error: { code: 'CONFLICT' } });
    const BookingCancelDialog = await loadBookingCancelDialog();
    const user = userEvent.setup();

    render(<BookingCancelDialog booking={baseBooking} />);

    await user.click(
      screen.getByRole('button', { name: translate('web.bookings.detail.cancel', 'cta') }),
    );
    await user.click(
      screen.getByRole('button', { name: translate('web.bookings.detail.cancel', 'confirmCta') }),
    );

    expect(
      await screen.findByText(translate('web.bookings', 'errors.conflict')),
    ).toBeInTheDocument();
    expect(routerRefreshMock).not.toHaveBeenCalled();
  });

  it('shows a mapped error and does not refresh when the request is rejected as unprocessable', async () => {
    apiPostMock.mockResolvedValue({ data: undefined, error: { code: 'UNPROCESSABLE_ENTITY' } });
    const BookingCancelDialog = await loadBookingCancelDialog();
    const user = userEvent.setup();

    render(<BookingCancelDialog booking={baseBooking} />);

    await user.click(
      screen.getByRole('button', { name: translate('web.bookings.detail.cancel', 'cta') }),
    );
    await user.click(
      screen.getByRole('button', { name: translate('web.bookings.detail.cancel', 'confirmCta') }),
    );

    expect(
      await screen.findByText(translate('web.bookings', 'errors.invalid')),
    ).toBeInTheDocument();
    expect(routerRefreshMock).not.toHaveBeenCalled();
  });
});
