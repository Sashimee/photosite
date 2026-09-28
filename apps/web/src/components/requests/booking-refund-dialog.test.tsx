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
  status: 'paid_held',
  releaseDueAt: null,
  deliveredAt: null,
  releasedAt: null,
  cancelledAt: null,
  cancellationReason: null,
};

async function loadBookingRefundDialog() {
  const { BookingRefundDialog } = await import('./booking-refund-dialog');
  return BookingRefundDialog;
}

async function openDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    screen.getByRole('button', { name: translate('web.bookings.detail.refund', 'cta') }),
  );
}

describe('BookingRefundDialog', () => {
  afterEach(() => {
    apiPostMock.mockReset();
    routerRefreshMock.mockReset();
  });

  it.each(['pending_payment', 'released', 'cancelled', 'refunded', 'disputed'] as const)(
    'renders nothing when the booking is %s',
    async (status) => {
      const BookingRefundDialog = await loadBookingRefundDialog();
      const { container } = render(<BookingRefundDialog booking={{ ...baseBooking, status }} />);
      expect(container).toBeEmptyDOMElement();
    },
  );

  it('submits a full refund without amountCents when the amount is left blank', async () => {
    apiPostMock.mockResolvedValue({ data: {}, error: undefined });
    const BookingRefundDialog = await loadBookingRefundDialog();
    const user = userEvent.setup();

    render(<BookingRefundDialog booking={baseBooking} />);
    await openDialog(user);

    await user.type(
      screen.getByLabelText(translate('web.bookings.detail.refund', 'reasonLabel')),
      'Client requested a full refund',
    );
    await user.click(
      screen.getByRole('button', { name: translate('web.bookings.detail.refund', 'submitCta') }),
    );

    expect(apiPostMock).toHaveBeenCalledWith('/v1/bookings/{id}/refund', {
      params: { path: { id: BOOKING_ID } },
      body: { reason: 'Client requested a full refund' },
    });
    expect(routerRefreshMock).toHaveBeenCalledTimes(1);
  });

  it('converts a decimal amount to integer cents for a partial refund', async () => {
    apiPostMock.mockResolvedValue({ data: {}, error: undefined });
    const BookingRefundDialog = await loadBookingRefundDialog();
    const user = userEvent.setup();

    render(<BookingRefundDialog booking={baseBooking} />);
    await openDialog(user);

    await user.type(
      screen.getByLabelText(translate('web.bookings.detail.refund', 'amountLabel')),
      '12.50',
    );
    await user.type(
      screen.getByLabelText(translate('web.bookings.detail.refund', 'reasonLabel')),
      'Partial refund for a late arrival',
    );
    await user.click(
      screen.getByRole('button', { name: translate('web.bookings.detail.refund', 'submitCta') }),
    );

    expect(apiPostMock).toHaveBeenCalledWith('/v1/bookings/{id}/refund', {
      params: { path: { id: BOOKING_ID } },
      body: { amountCents: 1250, reason: 'Partial refund for a late arrival' },
    });
    expect(routerRefreshMock).toHaveBeenCalledTimes(1);
  });

  it('shows a validation error and does not submit for an invalid amount', async () => {
    const BookingRefundDialog = await loadBookingRefundDialog();
    const user = userEvent.setup();

    render(<BookingRefundDialog booking={baseBooking} />);
    await openDialog(user);

    await user.type(
      screen.getByLabelText(translate('web.bookings.detail.refund', 'amountLabel')),
      'abc',
    );
    await user.type(
      screen.getByLabelText(translate('web.bookings.detail.refund', 'reasonLabel')),
      'Partial refund',
    );
    await user.click(
      screen.getByRole('button', { name: translate('web.bookings.detail.refund', 'submitCta') }),
    );

    expect(
      await screen.findByText(translate('web.bookings.detail.refund', 'invalidAmount')),
    ).toBeInTheDocument();
    expect(apiPostMock).not.toHaveBeenCalled();
  });

  it('shows a mapped error when the request is rejected as unprocessable', async () => {
    apiPostMock.mockResolvedValue({ data: undefined, error: { code: 'UNPROCESSABLE_ENTITY' } });
    const BookingRefundDialog = await loadBookingRefundDialog();
    const user = userEvent.setup();

    render(<BookingRefundDialog booking={baseBooking} />);
    await openDialog(user);

    await user.type(
      screen.getByLabelText(translate('web.bookings.detail.refund', 'amountLabel')),
      '10',
    );
    await user.type(
      screen.getByLabelText(translate('web.bookings.detail.refund', 'reasonLabel')),
      'Over-refund attempt',
    );
    await user.click(
      screen.getByRole('button', { name: translate('web.bookings.detail.refund', 'submitCta') }),
    );

    expect(
      await screen.findByText(translate('web.bookings', 'errors.invalid')),
    ).toBeInTheDocument();
    expect(routerRefreshMock).not.toHaveBeenCalled();
  });
});
