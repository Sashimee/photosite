import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { translate } from '@/testing/mock-translations';

const pushMock = vi.fn();
const refreshMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));
vi.mock('next-intl', async () => {
  const { mockUseTranslations } = await import('@/testing/mock-translations');
  return { useTranslations: mockUseTranslations };
});

const baseQuote = {
  id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  requestId: '3fa85f64-5717-4562-b3fc-2c963f66aaaa',
  photographerId: '3fa85f64-5717-4562-b3fc-2c963f66bbbb',
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

async function loadQuoteActions() {
  const { QuoteActions } = await import('./quote-actions');
  return QuoteActions;
}

describe('QuoteActions', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    pushMock.mockReset();
    refreshMock.mockReset();
  });

  it('renders nothing when the current user is not the quote client', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const QuoteActions = await loadQuoteActions();

    const { container } = render(<QuoteActions quote={baseQuote} currentUserId="someone-else" />);

    expect(container).toBeEmptyDOMElement();
  });

  it('hides accept and decline for a quote that is not sent', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const QuoteActions = await loadQuoteActions();

    render(
      <QuoteActions
        quote={{ ...baseQuote, status: 'accepted' }}
        currentUserId={baseQuote.clientId}
      />,
    );

    expect(
      screen.queryByRole('button', { name: translate('web.quotes.detail', 'acceptCta') }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: translate('web.quotes.detail', 'declineCta') }),
    ).not.toBeInTheDocument();
  });

  it('disables (but still shows) accept once validUntil is in the past, while decline stays enabled', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const QuoteActions = await loadQuoteActions();

    render(
      <QuoteActions
        quote={{ ...baseQuote, validUntil: '2020-01-01T00:00:00.000Z' }}
        currentUserId={baseQuote.clientId}
      />,
    );

    expect(
      screen.getByRole('button', { name: translate('web.quotes.detail', 'acceptCta') }),
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: translate('web.quotes.detail', 'declineCta') }),
    ).toBeEnabled();
  });

  it('accepts a sent quote and refreshes', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(baseQuote), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const QuoteActions = await loadQuoteActions();
    const user = userEvent.setup();

    render(<QuoteActions quote={baseQuote} currentUserId={baseQuote.clientId} />);

    await user.click(
      screen.getByRole('button', { name: translate('web.quotes.detail', 'acceptCta') }),
    );
    await user.click(
      await screen.findByRole('button', {
        name: translate('web.quotes.detail', 'acceptConfirmCta'),
      }),
    );

    const [request] = fetchMock.mock.calls[0] as [Request];
    expect(request.url).toContain(`/v1/quotes/${baseQuote.id}/accept`);
    expect(refreshMock).toHaveBeenCalled();
  });

  it('shows a mapped error and keeps the dialog open when accept is rejected', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ code: 'CONFLICT' }), { status: 409 }));
    vi.stubGlobal('fetch', fetchMock);
    const QuoteActions = await loadQuoteActions();
    const user = userEvent.setup();

    render(<QuoteActions quote={baseQuote} currentUserId={baseQuote.clientId} />);

    await user.click(
      screen.getByRole('button', { name: translate('web.quotes.detail', 'acceptCta') }),
    );
    await user.click(
      await screen.findByRole('button', {
        name: translate('web.quotes.detail', 'acceptConfirmCta'),
      }),
    );

    expect(await screen.findByText(translate('web.quotes', 'errors.conflict'))).toBeInTheDocument();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it('resets pending and shows a generic error when accept fails on the network', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);
    const QuoteActions = await loadQuoteActions();
    const user = userEvent.setup();

    render(<QuoteActions quote={baseQuote} currentUserId={baseQuote.clientId} />);

    await user.click(
      screen.getByRole('button', { name: translate('web.quotes.detail', 'acceptCta') }),
    );
    const confirmButton = await screen.findByRole('button', {
      name: translate('web.quotes.detail', 'acceptConfirmCta'),
    });
    await user.click(confirmButton);

    expect(await screen.findByText(translate('web.quotes', 'errors.generic'))).toBeInTheDocument();
    expect(refreshMock).not.toHaveBeenCalled();
    expect(
      screen.getByRole('button', { name: translate('web.quotes.detail', 'acceptConfirmCta') }),
    ).toBeEnabled();
  });

  it('clears a stale error once the dialog is reopened', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 'CONFLICT' }), { status: 409 }));
    vi.stubGlobal('fetch', fetchMock);
    const QuoteActions = await loadQuoteActions();
    const user = userEvent.setup();

    render(<QuoteActions quote={baseQuote} currentUserId={baseQuote.clientId} />);
    await user.click(
      screen.getByRole('button', { name: translate('web.quotes.detail', 'acceptCta') }),
    );
    await user.click(
      await screen.findByRole('button', {
        name: translate('web.quotes.detail', 'acceptConfirmCta'),
      }),
    );
    expect(await screen.findByText(translate('web.quotes', 'errors.conflict'))).toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: translate('web.quotes.detail', 'acceptDismissCta') }),
    );

    await user.click(
      screen.getByRole('button', { name: translate('web.quotes.detail', 'acceptCta') }),
    );

    expect(screen.queryByText(translate('web.quotes', 'errors.conflict'))).not.toBeInTheDocument();
  });
});
