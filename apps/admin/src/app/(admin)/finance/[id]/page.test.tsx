import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const serverApiMock = vi.fn();
vi.mock('@/lib/server-api', () => ({ serverApi: serverApiMock }));

const notFoundMock = vi.fn(() => {
  throw new Error('NEXT_NOT_FOUND');
});
vi.mock('next/navigation', () => ({ notFound: notFoundMock }));

vi.mock('next-intl', async () => {
  const { mockUseFormatter, mockUseTranslations } = await import('@/testing/mock-translations');
  return { useTranslations: mockUseTranslations, useFormatter: mockUseFormatter };
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
    refundableCents: 1500,
    reversibleCents: 800,
    disputeStatus: null,
    ledger: [],
    ledgerTruncated: false,
    disputes: [],
    payout: null,
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
  it('shows the money summary with the API refundable and reversible figures, the limit explanation, stripe ids as text and the actions', async () => {
    serverApiMock.mockResolvedValue({
      GET: vi.fn().mockResolvedValue({ data: booking(), response: { status: 200 } }),
    });

    await renderPage();

    expect(screen.getByText('booking-1')).toBeInTheDocument();
    expect(screen.getAllByText('Released')).toHaveLength(2);
    expect(screen.getByText('€120.00')).toBeInTheDocument();
    expect(screen.getByText('€25.00')).toBeInTheDocument();
    expect(screen.getByText('€10.00')).toBeInTheDocument();
    expect(screen.getByText('€15.00')).toBeInTheDocument();
    expect(screen.getByText('€8.00')).toBeInTheDocument();
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

  it('renders ledger rows with signed amounts, type labels and copyable stripe ids', async () => {
    serverApiMock.mockResolvedValue({
      GET: vi.fn().mockResolvedValue({
        data: booking({
          ledger: [
            {
              id: 'l1',
              type: 'charge',
              amountCents: 12000,
              currency: 'EUR',
              stripeObjectId: 'ch_123',
              occurredAt: '2026-09-18T10:00:00.000Z',
            },
            {
              id: 'l2',
              type: 'platform_fee',
              amountCents: -600,
              currency: 'EUR',
              stripeObjectId: 'fee_1',
              occurredAt: '2026-09-18T10:00:01.000Z',
            },
          ],
        }),
        response: { status: 200 },
      }),
    });

    await renderPage();

    expect(screen.getByText('Platform fee')).toBeInTheDocument();
    expect(screen.getByText('-€6.00')).toBeInTheDocument();
    expect(screen.getByText('fee_1')).toBeInTheDocument();
    expect(screen.queryByText(/More exist/)).not.toBeInTheDocument();
  });

  it('says so when the ledger is truncated', async () => {
    serverApiMock.mockResolvedValue({
      GET: vi.fn().mockResolvedValue({
        data: booking({ ledgerTruncated: true }),
        response: { status: 200 },
      }),
    });

    await renderPage();

    expect(screen.getByText(/More exist/)).toBeInTheDocument();
  });

  it('shows the empty states for ledger and disputes and no Connect account', async () => {
    serverApiMock.mockResolvedValue({
      GET: vi.fn().mockResolvedValue({ data: booking(), response: { status: 200 } }),
    });

    await renderPage();

    expect(screen.getByText('No ledger entries yet.')).toBeInTheDocument();
    expect(screen.getByText('No disputes on this booking.')).toBeInTheDocument();
    expect(screen.getByText(/no Connect account on record/)).toBeInTheDocument();
  });

  it('renders disputes with ids only and the payout block with its empty entries state', async () => {
    serverApiMock.mockResolvedValue({
      GET: vi.fn().mockResolvedValue({
        data: booking({
          disputes: [
            {
              id: 'd1',
              status: 'open',
              reason: 'fraudulent',
              resolution: null,
              amountRefundedCents: null,
              openedById: 'user-9',
              adminId: null,
              openedAt: '2026-09-22T10:00:00.000Z',
              updatedAt: '2026-09-22T10:00:00.000Z',
            },
          ],
          payout: {
            stripeAccountId: 'acct_1',
            onboardingComplete: true,
            payoutsEnabled: false,
            entries: [],
          },
        }),
        response: { status: 200 },
      }),
    });

    await renderPage();

    expect(screen.getByText('d1')).toBeInTheDocument();
    expect(screen.getByText('user-9')).toBeInTheDocument();
    expect(screen.getByText('fraudulent')).toBeInTheDocument();
    expect(screen.getByText('acct_1')).toBeInTheDocument();
    expect(screen.getByText('Yes')).toBeInTheDocument();
    expect(screen.getByText('No')).toBeInTheDocument();
    expect(screen.getByText(/No payout entries recorded/)).toBeInTheDocument();
  });
});
