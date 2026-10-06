import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const serverApiMock = vi.fn();
vi.mock('@/lib/server-api', () => ({ serverApi: serverApiMock }));

const notFoundMock = vi.fn(() => {
  throw new Error('NEXT_NOT_FOUND');
});
vi.mock('next/navigation', () => ({ notFound: notFoundMock }));

vi.mock('next-intl', async () => {
  const { mockUseTranslations } = await import('@/testing/mock-translations');
  return { useTranslations: mockUseTranslations };
});

vi.mock('next-intl/server', async () => {
  const { mockUseFormatter, translate } = await import('@/testing/mock-translations');
  return {
    getTranslations: (namespace: string) => (key: string, values?: Record<string, unknown>) =>
      translate(namespace, key, values),
    getFormatter: () => mockUseFormatter(),
  };
});

const bookingActionsMock = vi.fn((props: Record<string, unknown>) => (
  <div data-testid="booking-actions" data-props={JSON.stringify(props)} />
));
vi.mock('./booking-actions', () => ({ BookingActions: bookingActionsMock }));

function booking(overrides: Record<string, unknown> = {}) {
  return {
    id: 'booking-1',
    quoteId: 'quote-1',
    clientId: 'client-1',
    photographerId: 'photographer-1',
    scheduledAt: null,
    location: null,
    total: { amountCents: 12000, currency: 'EUR' },
    status: 'released',
    releaseDueAt: null,
    deliveredAt: '2026-09-18T10:00:00.000Z',
    releasedAt: '2026-09-20T12:00:00.000Z',
    cancelledAt: null,
    cancellationReason: null,
    paymentIntentId: 'pi_123',
    chargeId: 'ch_123',
    transferId: null,
    refundedCents: 2500,
    reversedCents: 1000,
    disputeStatus: null,
    ...overrides,
  };
}

async function renderPage() {
  const Page = (await import('./page')).default;
  render(await Page({ params: Promise.resolve({ id: 'booking-1' }) }));
}

beforeEach(() => {
  serverApiMock.mockReset();
  notFoundMock.mockClear();
  bookingActionsMock.mockClear();
});

describe('BookingPage', () => {
  it('shows the money summary with the limit explanation and no computed refundable figure, stripe ids as text and the actions', async () => {
    serverApiMock.mockResolvedValue({
      GET: vi.fn().mockResolvedValue({ data: booking(), response: { status: 200 } }),
    });

    await renderPage();

    expect(screen.getByText('booking-1')).toBeInTheDocument();
    expect(screen.getAllByText('Released')).toHaveLength(2);
    expect(screen.getByText('€120.00')).toBeInTheDocument();
    expect(screen.getByText('€25.00')).toBeInTheDocument();
    expect(screen.getByText('€10.00')).toBeInTheDocument();
    expect(screen.queryByText('€95.00')).not.toBeInTheDocument();
    expect(screen.getByText(/platform fee is not refunded/)).toBeInTheDocument();
    expect(screen.getByText('pi_123')).toBeInTheDocument();
    expect(screen.getByText('ch_123')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    const props = bookingActionsMock.mock.calls[0]?.[0];
    expect(props).toEqual({
      bookingId: 'booking-1',
      status: 'released',
      transferId: null,
      currency: 'EUR',
    });
  });

  it('shows the dispute status and the cancellation reason when present', async () => {
    serverApiMock.mockResolvedValue({
      GET: vi.fn().mockResolvedValue({
        data: booking({
          status: 'cancelled',
          disputeStatus: 'lost',
          cancelledAt: '2026-09-21T09:00:00.000Z',
          cancellationReason: 'Client changed plans',
        }),
        response: { status: 200 },
      }),
    });

    await renderPage();

    expect(screen.getByText('Lost')).toBeInTheDocument();
    expect(screen.getByText('Client changed plans')).toBeInTheDocument();
  });

  it('renders not found on 404', async () => {
    serverApiMock.mockResolvedValue({
      GET: vi.fn().mockResolvedValue({ data: undefined, response: { status: 404 } }),
    });
    const Page = (await import('./page')).default;

    await expect(Page({ params: Promise.resolve({ id: 'x' }) })).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('throws on any other failure', async () => {
    serverApiMock.mockResolvedValue({
      GET: vi.fn().mockResolvedValue({ data: undefined, response: { status: 500 } }),
    });
    const Page = (await import('./page')).default;

    await expect(Page({ params: Promise.resolve({ id: 'x' }) })).rejects.toThrow(/HTTP 500/);
  });

  it('throws on 403 instead of rendering not found', async () => {
    serverApiMock.mockResolvedValue({
      GET: vi.fn().mockResolvedValue({ data: undefined, response: { status: 403 } }),
    });
    const Page = (await import('./page')).default;

    await expect(Page({ params: Promise.resolve({ id: 'x' }) })).rejects.toThrow(/HTTP 403/);
    expect(notFoundMock).not.toHaveBeenCalled();
  });

  it('shows "None" for a missing dispute and every missing stripe id, and omits empty timestamps', async () => {
    serverApiMock.mockResolvedValue({
      GET: vi.fn().mockResolvedValue({
        data: booking({
          status: 'pending_payment',
          paymentIntentId: null,
          chargeId: null,
          transferId: null,
          deliveredAt: null,
          releasedAt: null,
          refundedCents: 0,
          reversedCents: 0,
        }),
        response: { status: 200 },
      }),
    });

    await renderPage();

    expect(screen.getAllByText('None')).toHaveLength(4);
    expect(screen.queryByText('Delivered')).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(bookingActionsMock.mock.calls[0]?.[0]).toMatchObject({
      transferId: null,
    });
  });

  it('renders the transfer id as plain text and passes it to the actions', async () => {
    serverApiMock.mockResolvedValue({
      GET: vi.fn().mockResolvedValue({
        data: booking({ transferId: 'tr_123' }),
        response: { status: 200 },
      }),
    });

    await renderPage();

    expect(screen.getByText('tr_123')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(bookingActionsMock.mock.calls[0]?.[0]).toMatchObject({ transferId: 'tr_123' });
  });

  it('passes a disputed booking through with its transfer so only reverse is offered', async () => {
    serverApiMock.mockResolvedValue({
      GET: vi.fn().mockResolvedValue({
        data: booking({ status: 'disputed', disputeStatus: 'needs_response', transferId: 'tr_9' }),
        response: { status: 200 },
      }),
    });

    await renderPage();

    expect(bookingActionsMock.mock.calls[0]?.[0]).toMatchObject({
      status: 'disputed',
      transferId: 'tr_9',
    });
  });

  it('formats cents with the booking currency minor unit', async () => {
    serverApiMock.mockResolvedValue({
      GET: vi.fn().mockResolvedValue({
        data: booking({
          total: { amountCents: 5000, currency: 'JPY' },
          refundedCents: 1000,
          reversedCents: 0,
        }),
        response: { status: 200 },
      }),
    });

    await renderPage();

    expect(screen.getByText('¥5,000')).toBeInTheDocument();
    expect(screen.getByText('¥1,000')).toBeInTheDocument();
    expect(bookingActionsMock.mock.calls[0]?.[0]).toMatchObject({
      currency: 'JPY',
    });
  });
});
