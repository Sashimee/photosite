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

describe('BookingDocumentButton', () => {
  afterEach(() => {
    apiGetMock.mockReset();
    vi.restoreAllMocks();
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

  it('fetches the presigned url and opens it for the receipt', async () => {
    apiGetMock.mockResolvedValue({
      data: { url: 'https://cdn.photoo.lu/receipt.pdf' },
      error: undefined,
    });
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
    expect(openSpy).toHaveBeenCalledWith(
      'https://cdn.photoo.lu/receipt.pdf',
      '_blank',
      'noopener,noreferrer',
    );
  });

  it('fetches the fee invoice document', async () => {
    apiGetMock.mockResolvedValue({
      data: { url: 'https://cdn.photoo.lu/invoice.pdf' },
      error: undefined,
    });
    vi.spyOn(window, 'open').mockImplementation(() => null);
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

  it('shows the preparing message on a conflict instead of the generic error', async () => {
    apiGetMock.mockResolvedValue({ data: undefined, error: { code: 'CONFLICT' } });
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
  });

  it('shows a mapped error for other failures', async () => {
    apiGetMock.mockResolvedValue({ data: undefined, error: { code: 'FORBIDDEN' } });
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
  });
});
