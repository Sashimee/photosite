import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { translate } from '@/testing/mock-translations';

const pushMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));
vi.mock('next-intl', async () => {
  const { mockUseTranslations } = await import('@/testing/mock-translations');
  return { useTranslations: mockUseTranslations };
});

async function loadDirectQuoteButton() {
  const { DirectQuoteButton } = await import('./direct-quote-button');
  return DirectQuoteButton;
}

describe('DirectQuoteButton', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    pushMock.mockReset();
  });

  it('posts only the productTierId, never a price, and redirects to the quote', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ id: 'quote-1' }), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    const DirectQuoteButton = await loadDirectQuoteButton();
    const user = userEvent.setup();

    render(
      <DirectQuoteButton
        locale="en"
        slug="jane-doe"
        productId="product-1"
        tierId="tier-1"
        label="Request this package"
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Request this package' }));

    const [request] = fetchMock.mock.calls[0] as [Request];
    expect(request.url).toContain('/v1/photographers/jane-doe/products/product-1/quotes');
    const body = (await request.json()) as Record<string, unknown>;
    expect(body).toEqual({ productTierId: 'tier-1' });
    expect(pushMock).toHaveBeenCalledWith('/en/quotes/quote-1');
  });

  it('shows a mapped error and does not redirect when the request fails', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ code: 'CONFLICT' }), { status: 409 }));
    vi.stubGlobal('fetch', fetchMock);
    const DirectQuoteButton = await loadDirectQuoteButton();
    const user = userEvent.setup();

    render(
      <DirectQuoteButton
        locale="en"
        slug="jane-doe"
        productId="product-1"
        tierId="tier-1"
        label="Request this package"
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Request this package' }));

    expect(await screen.findByText(translate('web.quotes', 'errors.conflict'))).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('resets pending and shows a generic error when the network request fails', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);
    const DirectQuoteButton = await loadDirectQuoteButton();
    const user = userEvent.setup();

    render(
      <DirectQuoteButton
        locale="en"
        slug="jane-doe"
        productId="product-1"
        tierId="tier-1"
        label="Request this package"
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Request this package' }));

    expect(await screen.findByText(translate('web.quotes', 'errors.generic'))).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Request this package' })).toBeEnabled();
  });
});
