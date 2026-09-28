import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { translate } from '@/testing/mock-translations';

import type { Booking } from './booking-card';

const apiGetMock = vi.fn();

vi.mock('@/lib/api', () => ({ api: { GET: apiGetMock } }));
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
  status: 'released',
  releaseDueAt: null,
  deliveredAt: '2026-12-05T10:00:00.000Z',
  releasedAt: '2026-12-10T10:00:00.000Z',
  cancelledAt: null,
  cancellationReason: null,
};

async function loadBookingDocumentButton() {
  const { BookingDocumentButton } = await import('./booking-document-button');
  return BookingDocumentButton;
}

const originalLocation = window.location;

function stubLocationAssign() {
  const assign = vi.fn();
  const location = Object.create(originalLocation) as Location;
  Object.defineProperty(location, 'assign', { configurable: true, value: assign });
  Object.defineProperty(window, 'location', { configurable: true, value: location });
  return assign;
}

describe('BookingDocumentButton', () => {
  afterEach(() => {
    apiGetMock.mockReset();
    vi.restoreAllMocks();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation,
    });
  });

  it.each([
    'pending_payment',
    'paid_held',
    'in_progress',
    'delivered',
    'cancelled',
    'refunded',
    'disputed',
  ] as const)('renders nothing when the booking is %s', async (status) => {
    const BookingDocumentButton = await loadBookingDocumentButton();
    const { container } = render(
      <BookingDocumentButton booking={{ ...baseBooking, status }} document="receipt" />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('fetches the presigned url and navigates to it for the receipt', async () => {
    apiGetMock.mockResolvedValue({
      data: { url: 'https://cdn.photoo.lu/receipt.pdf' },
      error: undefined,
    });
    const assignSpy = stubLocationAssign();
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    const BookingDocumentButton = await loadBookingDocumentButton();
    const user = userEvent.setup();

    render(<BookingDocumentButton booking={baseBooking} document="receipt" />);

    await user.click(
      screen.getByRole('button', {
        name: translate('web.bookings.detail.documents', 'receiptCta'),
      }),
    );

    expect(apiGetMock).toHaveBeenCalledWith('/v1/bookings/{id}/documents/{document}', {
      params: { path: { id: BOOKING_ID, document: 'receipt' } },
    });
    expect(assignSpy).toHaveBeenCalledWith('https://cdn.photoo.lu/receipt.pdf');
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('fetches the fee invoice document', async () => {
    apiGetMock.mockResolvedValue({
      data: { url: 'https://cdn.photoo.lu/invoice.pdf' },
      error: undefined,
    });
    stubLocationAssign();
    const BookingDocumentButton = await loadBookingDocumentButton();
    const user = userEvent.setup();

    render(<BookingDocumentButton booking={baseBooking} document="fee-invoice" />);

    await user.click(
      screen.getByRole('button', {
        name: translate('web.bookings.detail.documents', 'feeInvoiceCta'),
      }),
    );

    expect(apiGetMock).toHaveBeenCalledWith('/v1/bookings/{id}/documents/{document}', {
      params: { path: { id: BOOKING_ID, document: 'fee-invoice' } },
    });
  });

  it('shows the preparing message on a conflict instead of navigating', async () => {
    apiGetMock.mockResolvedValue({ data: undefined, error: { code: 'CONFLICT' } });
    const assignSpy = stubLocationAssign();
    const BookingDocumentButton = await loadBookingDocumentButton();
    const user = userEvent.setup();

    render(<BookingDocumentButton booking={baseBooking} document="receipt" />);

    await user.click(
      screen.getByRole('button', {
        name: translate('web.bookings.detail.documents', 'receiptCta'),
      }),
    );

    expect(
      await screen.findByText(translate('web.bookings.detail.documents', 'preparing')),
    ).toBeInTheDocument();
    expect(assignSpy).not.toHaveBeenCalled();
  });

  it('shows a mapped error for other failures without navigating', async () => {
    apiGetMock.mockResolvedValue({ data: undefined, error: { code: 'FORBIDDEN' } });
    const assignSpy = stubLocationAssign();
    const BookingDocumentButton = await loadBookingDocumentButton();
    const user = userEvent.setup();

    render(<BookingDocumentButton booking={baseBooking} document="receipt" />);

    await user.click(
      screen.getByRole('button', {
        name: translate('web.bookings.detail.documents', 'receiptCta'),
      }),
    );

    expect(
      await screen.findByText(translate('web.bookings', 'errors.forbidden')),
    ).toBeInTheDocument();
    expect(assignSpy).not.toHaveBeenCalled();
  });
});
