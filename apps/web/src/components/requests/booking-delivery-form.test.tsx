import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, afterEach } from 'vitest';

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

async function loadBookingDeliveryForm() {
  const { BookingDeliveryForm } = await import('./booking-delivery-form');
  return BookingDeliveryForm;
}

describe('BookingDeliveryForm', () => {
  afterEach(() => {
    apiPostMock.mockReset();
    routerRefreshMock.mockReset();
  });

  it.each([
    'pending_payment',
    'delivered',
    'released',
    'cancelled',
    'refunded',
    'disputed',
  ] as const)('renders nothing when the booking is %s', async (status) => {
    const BookingDeliveryForm = await loadBookingDeliveryForm();
    const { container } = render(<BookingDeliveryForm booking={{ ...baseBooking, status }} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('submits the message and external link and refreshes on success', async () => {
    apiPostMock.mockResolvedValue({ data: {}, error: undefined });
    const BookingDeliveryForm = await loadBookingDeliveryForm();
    const user = userEvent.setup();

    render(<BookingDeliveryForm booking={baseBooking} />);

    await user.type(
      screen.getByLabelText(translate('web.bookings.detail.delivery', 'messageLabel')),
      'Here are the final photos.',
    );
    await user.type(
      screen.getByLabelText(translate('web.bookings.detail.delivery', 'externalLinkLabel')),
      'https://example.com/gallery',
    );
    await user.click(
      screen.getByRole('button', {
        name: translate('web.bookings.detail.delivery', 'submitCta'),
      }),
    );

    expect(apiPostMock).toHaveBeenCalledWith('/v1/bookings/{id}/delivery', {
      params: { path: { id: BOOKING_ID } },
      body: { message: 'Here are the final photos.', externalLink: 'https://example.com/gallery' },
    });
    expect(
      await screen.findByText(translate('web.bookings.detail.delivery', 'success')),
    ).toBeInTheDocument();
    expect(routerRefreshMock).toHaveBeenCalledTimes(1);
  });

  it('does not submit when the external link is missing', async () => {
    const BookingDeliveryForm = await loadBookingDeliveryForm();
    const user = userEvent.setup();

    render(<BookingDeliveryForm booking={baseBooking} />);

    await user.type(
      screen.getByLabelText(translate('web.bookings.detail.delivery', 'messageLabel')),
      'Here are the final photos.',
    );
    await user.click(
      screen.getByRole('button', {
        name: translate('web.bookings.detail.delivery', 'submitCta'),
      }),
    );

    expect(apiPostMock).not.toHaveBeenCalled();
  });

  it('shows a mapped error when the request is rejected as a conflict', async () => {
    apiPostMock.mockResolvedValue({ data: undefined, error: { code: 'CONFLICT' } });
    const BookingDeliveryForm = await loadBookingDeliveryForm();
    const user = userEvent.setup();

    render(<BookingDeliveryForm booking={baseBooking} />);

    await user.type(
      screen.getByLabelText(translate('web.bookings.detail.delivery', 'messageLabel')),
      'Here are the final photos.',
    );
    await user.type(
      screen.getByLabelText(translate('web.bookings.detail.delivery', 'externalLinkLabel')),
      'https://example.com/gallery',
    );
    await user.click(
      screen.getByRole('button', {
        name: translate('web.bookings.detail.delivery', 'submitCta'),
      }),
    );

    expect(
      await screen.findByText(translate('web.bookings', 'errors.conflict')),
    ).toBeInTheDocument();
    expect(routerRefreshMock).not.toHaveBeenCalled();
  });
});
