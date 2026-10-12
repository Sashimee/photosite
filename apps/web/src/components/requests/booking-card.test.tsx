import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { translate } from '@/testing/mock-translations';

vi.mock('next-intl/server', () => ({
  getTranslations:
    ({ namespace }: { namespace: string }) =>
    (key: string, values?: Record<string, unknown>) =>
      translate(namespace, key, values),
}));

const baseBooking = {
  id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  quoteId: '3fa85f64-5717-4562-b3fc-2c963f66aaaa',
  clientId: '3fa85f64-5717-4562-b3fc-2c963f66cccc',
  photographerId: '3fa85f64-5717-4562-b3fc-2c963f66dddd',
  total: { amountCents: 157500, currency: 'EUR' as const },
  scheduledAt: '2026-12-01T10:00:00.000Z',
  location: { lat: 49.6116, lng: 6.1319 },
  status: 'pending_payment' as const,
  releaseDueAt: null,
  deliveredAt: null,
  releasedAt: null,
  cancelledAt: null,
  cancellationReason: null,
};

describe('BookingCard', () => {
  it('links to the booking detail page under the default base path and shows the total and schedule', async () => {
    const { BookingCard } = await import('./booking-card');
    const element = await BookingCard({ booking: baseBooking, locale: 'en' });
    render(element);

    expect(screen.getByRole('link')).toHaveAttribute('href', `/en/bookings/${baseBooking.id}`);
    expect(screen.getByText('€1,575.00')).toBeInTheDocument();
    expect(
      screen.getByText(translate('web.bookings.status', 'pending_payment')),
    ).toBeInTheDocument();
    expect(screen.getByText(/Scheduled for/)).toBeInTheDocument();
  });

  it('links under a custom base path when given one', async () => {
    const { BookingCard } = await import('./booking-card');
    const element = await BookingCard({
      booking: baseBooking,
      locale: 'en',
      basePath: '/en/dashboard/bookings',
    });
    render(element);

    expect(screen.getByRole('link')).toHaveAttribute(
      'href',
      `/en/dashboard/bookings/${baseBooking.id}`,
    );
  });

  it('shows a not-scheduled label when there is no scheduled date', async () => {
    const { BookingCard } = await import('./booking-card');
    const element = await BookingCard({
      booking: { ...baseBooking, scheduledAt: null },
      locale: 'en',
    });
    render(element);

    expect(screen.getByText(translate('web.bookings.detail', 'notScheduled'))).toBeInTheDocument();
  });
});
