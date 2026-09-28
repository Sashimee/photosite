import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { translate } from '@/testing/mock-translations';

import type { Booking } from './booking-card';

vi.mock('next-intl/server', () => ({
  getTranslations:
    ({ namespace }: { namespace: string }) =>
    (key: string, values?: Record<string, unknown>) =>
      translate(namespace, key, values),
}));

vi.mock('./booking-checkout', () => ({
  BookingCheckout: ({ bookingId, returnUrl }: { bookingId: string; returnUrl: string }) => (
    <div data-testid="booking-checkout" data-booking-id={bookingId} data-return-url={returnUrl} />
  ),
}));

vi.mock('./booking-status-timeline', () => ({
  BookingStatusTimeline: ({ status }: { status: string }) => (
    <div data-testid="booking-status-timeline" data-status={status} />
  ),
}));

const baseBooking: Booking = {
  id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
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

describe('BookingDetail', () => {
  it('renders the checkout when the booking is pending payment and a return url is given', async () => {
    const { BookingDetail } = await import('./booking-detail');
    const element = await BookingDetail({
      booking: baseBooking,
      locale: 'en',
      backHref: '/en/bookings',
      backLabel: 'Back to bookings',
      checkoutReturnUrl: 'https://photoo.lu/en/bookings/return',
    });
    render(element);

    const checkout = screen.getByTestId('booking-checkout');
    expect(checkout).toHaveAttribute('data-booking-id', baseBooking.id);
    expect(checkout).toHaveAttribute('data-return-url', 'https://photoo.lu/en/bookings/return');
  });

  it('does not render the checkout without a return url, even when pending payment', async () => {
    const { BookingDetail } = await import('./booking-detail');
    const element = await BookingDetail({
      booking: baseBooking,
      locale: 'en',
      backHref: '/en/bookings',
      backLabel: 'Back to bookings',
    });
    render(element);

    expect(screen.queryByTestId('booking-checkout')).not.toBeInTheDocument();
  });

  it('does not render the checkout once the booking is no longer pending payment, even with a return url', async () => {
    const { BookingDetail } = await import('./booking-detail');
    const element = await BookingDetail({
      booking: { ...baseBooking, status: 'paid_held' },
      locale: 'en',
      backHref: '/en/bookings',
      backLabel: 'Back to bookings',
      checkoutReturnUrl: 'https://photoo.lu/en/bookings/return',
    });
    render(element);

    expect(screen.queryByTestId('booking-checkout')).not.toBeInTheDocument();
  });

  it.each(['in_progress', 'delivered', 'released', 'cancelled', 'refunded', 'disputed'] as const)(
    'does not render the checkout when the booking is %s, even with a return url',
    async (status) => {
      const { BookingDetail } = await import('./booking-detail');
      const element = await BookingDetail({
        booking: { ...baseBooking, status },
        locale: 'en',
        backHref: '/en/bookings',
        backLabel: 'Back to bookings',
        checkoutReturnUrl: 'https://photoo.lu/en/bookings/return',
      });
      render(element);

      expect(screen.queryByTestId('booking-checkout')).not.toBeInTheDocument();
    },
  );

  it('does not render the checkout without a return url and not pending payment', async () => {
    const { BookingDetail } = await import('./booking-detail');
    const element = await BookingDetail({
      booking: { ...baseBooking, status: 'paid_held' },
      locale: 'en',
      backHref: '/en/bookings',
      backLabel: 'Back to bookings',
    });
    render(element);

    expect(screen.queryByTestId('booking-checkout')).not.toBeInTheDocument();
  });

  it('shows the total, schedule and location, and links back', async () => {
    const { BookingDetail } = await import('./booking-detail');
    const element = await BookingDetail({
      booking: baseBooking,
      locale: 'en',
      backHref: '/en/bookings',
      backLabel: 'Back to bookings',
    });
    render(element);

    expect(screen.getByRole('link', { name: 'Back to bookings' })).toHaveAttribute(
      'href',
      '/en/bookings',
    );
    expect(screen.getByRole('heading', { level: 1, name: '€1,575.00' })).toBeInTheDocument();
    expect(screen.getByText(/Scheduled for/)).toBeInTheDocument();
    expect(
      screen.getByText(
        translate('web.bookings.detail', 'coordinates', { lat: 49.6116, lng: 6.1319 }),
        { exact: false },
      ),
    ).toBeInTheDocument();
  });

  it('shows a not-scheduled and no-location message when both are missing', async () => {
    const { BookingDetail } = await import('./booking-detail');
    const element = await BookingDetail({
      booking: { ...baseBooking, scheduledAt: null, location: null },
      locale: 'en',
      backHref: '/en/bookings',
      backLabel: 'Back to bookings',
    });
    render(element);

    expect(screen.getByText(translate('web.bookings.detail', 'notScheduled'))).toBeInTheDocument();
    expect(
      screen.getByText(translate('web.bookings.detail', 'noLocation'), { exact: false }),
    ).toBeInTheDocument();
  });
});
