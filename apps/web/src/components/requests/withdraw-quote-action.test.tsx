import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { translate } from '@/testing/mock-translations';

const refreshMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));
vi.mock('next-intl', async () => {
  const { mockUseTranslations } = await import('@/testing/mock-translations');
  return { useTranslations: mockUseTranslations };
});

const baseQuote = {
  id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  requestId: '3fa85f64-5717-4562-b3fc-2c963f66aaaa',
  photographerId: '3fa85f64-5717-4562-b3fc-2c963f66bbbb',
  photographer: {
    id: '3fa85f64-5717-4562-b3fc-2c963f66bbbb',
    slug: 'jane-doe',
    displayName: 'Jane Doe',
    avatarUrl: null,
    city: 'Luxembourg',
    countryCode: 'LU',
    ratingAvg: 4.5,
    ratingCount: 12,
  },
  clientId: '3fa85f64-5717-4562-b3fc-2c963f66cccc',
  productId: null,
  productTierId: null,
  lineItems: [{ label: 'Full day coverage', qty: 1, unitCents: 150000 }],
  subtotal: { amountCents: 150000, currency: 'EUR' },
  platformFee: { amountCents: 7500, currency: 'EUR' },
  total: { amountCents: 157500, currency: 'EUR' },
  validUntil: '2026-12-01T00:00:00.000Z',
  message: null,
  status: 'sent' as const,
};

async function loadWithdrawQuoteAction() {
  const { WithdrawQuoteAction } = await import('./withdraw-quote-action');
  return WithdrawQuoteAction;
}

describe('WithdrawQuoteAction', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    refreshMock.mockReset();
  });

  it('renders nothing once the quote is no longer sent', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const WithdrawQuoteAction = await loadWithdrawQuoteAction();

    const { container } = render(
      <WithdrawQuoteAction quote={{ ...baseQuote, status: 'accepted' }} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('withdraws a sent quote and refreshes', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ ...baseQuote, status: 'withdrawn' }), { status: 200 }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const WithdrawQuoteAction = await loadWithdrawQuoteAction();
    const user = userEvent.setup();

    render(<WithdrawQuoteAction quote={baseQuote} />);

    await user.click(
      screen.getByRole('button', { name: translate('web.quotes.detail', 'withdrawCta') }),
    );
    await user.click(
      await screen.findByRole('button', {
        name: translate('web.quotes.detail', 'withdrawConfirmCta'),
      }),
    );

    const [request] = fetchMock.mock.calls[0] as [Request];
    expect(request.url).toContain(`/v1/quotes/${baseQuote.id}/withdraw`);
    expect(refreshMock).toHaveBeenCalled();
  });

  it('shows a mapped error and keeps the dialog open when withdraw is rejected because the quote already moved on', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ code: 'CONFLICT' }), { status: 409 }));
    vi.stubGlobal('fetch', fetchMock);
    const WithdrawQuoteAction = await loadWithdrawQuoteAction();
    const user = userEvent.setup();

    render(<WithdrawQuoteAction quote={baseQuote} />);

    await user.click(
      screen.getByRole('button', { name: translate('web.quotes.detail', 'withdrawCta') }),
    );
    await user.click(
      await screen.findByRole('button', {
        name: translate('web.quotes.detail', 'withdrawConfirmCta'),
      }),
    );

    expect(await screen.findByText(translate('web.quotes', 'errors.conflict'))).toBeInTheDocument();
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
