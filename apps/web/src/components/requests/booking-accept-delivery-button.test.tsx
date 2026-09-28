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
  status: 'delivered',
  releaseDueAt: null,
  deliveredAt: '2026-12-05T10:00:00.000Z',
  releasedAt: null,
  cancelledAt: null,
  cancellationReason: null,
};

async function loadBookingAcceptDeliveryButton() {
  const { BookingAcceptDeliveryButton } = await import('./booking-accept-delivery-button');
  return BookingAcceptDeliveryButton;
}

describe('BookingAcceptDeliveryButton', () => {
  afterEach(() => {
    apiPostMock.mockReset();
    routerRefreshMock.mockReset();
  });

  it.each([
    'pending_payment',
    'paid_held',
    'in_progress',
    'released',
    'cancelled',
    'refunded',
    'disputed',
  ] as const)('renders nothing when the booking is %s', async (status) => {
    const BookingAcceptDeliveryButton = await loadBookingAcceptDeliveryButton();
    const { container } = render(
      <BookingAcceptDeliveryButton booking={{ ...baseBooking, status }} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('accepts the delivery and refreshes on confirm', async () => {
    apiPostMock.mockResolvedValue({ data: {}, error: undefined });
    const BookingAcceptDeliveryButton = await loadBookingAcceptDeliveryButton();
    const user = userEvent.setup();

    render(<BookingAcceptDeliveryButton booking={baseBooking} />);

    await user.click(
      screen.getByRole('button', {
        name: translate('web.bookings.detail.acceptDelivery', 'cta'),
      }),
    );
    await user.click(
      screen.getByRole('button', {
        name: translate('web.bookings.detail.acceptDelivery', 'confirmCta'),
      }),
    );

    expect(apiPostMock).toHaveBeenCalledWith('/v1/bookings/{id}/accept-delivery', {
      params: { path: { id: BOOKING_ID } },
    });
    expect(routerRefreshMock).toHaveBeenCalledTimes(1);
  });

  it('shows a mapped error and keeps the dialog open when the request fails', async () => {
    apiPostMock.mockResolvedValue({ data: undefined, error: { code: 'FORBIDDEN' } });
    const BookingAcceptDeliveryButton = await loadBookingAcceptDeliveryButton();
    const user = userEvent.setup();

    render(<BookingAcceptDeliveryButton booking={baseBooking} />);

    await user.click(
      screen.getByRole('button', {
        name: translate('web.bookings.detail.acceptDelivery', 'cta'),
      }),
    );
    await user.click(
      screen.getByRole('button', {
        name: translate('web.bookings.detail.acceptDelivery', 'confirmCta'),
      }),
    );

    expect(
      await screen.findByText(translate('web.bookings', 'errors.forbidden')),
    ).toBeInTheDocument();
    expect(routerRefreshMock).not.toHaveBeenCalled();
    expect(
      screen.getByRole('button', {
        name: translate('web.bookings.detail.acceptDelivery', 'confirmCta'),
      }),
    ).toBeInTheDocument();
  });
});
