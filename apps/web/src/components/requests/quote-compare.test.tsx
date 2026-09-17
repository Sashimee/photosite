import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { components } from '@photoo/api-client';

import { translate } from '@/testing/mock-translations';

type Quote = components['schemas']['Quote'];

vi.mock('next-intl/server', () => ({
  getTranslations:
    ({ namespace }: { namespace: string }) =>
    (key: string, values?: Record<string, unknown>) =>
      translate(namespace, key, values),
}));
vi.mock('next-intl', async () => {
  const { mockUseTranslations } = await import('@/testing/mock-translations');
  return { useTranslations: mockUseTranslations };
});
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

function makeQuote(overrides: Partial<Quote> = {}): Quote {
  return {
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
    status: 'sent',
    ...overrides,
  };
}

async function loadQuoteCompare() {
  const { QuoteCompare } = await import('./quote-compare');
  return QuoteCompare;
}

describe('QuoteCompare', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('only lists sent quotes, skipping draft, accepted, declined, expired and withdrawn ones', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const QuoteCompare = await loadQuoteCompare();
    const quotes = [
      makeQuote({ id: 'sent-1', status: 'sent' }),
      makeQuote({ id: 'draft-1', status: 'draft' }),
      makeQuote({ id: 'accepted-1', status: 'accepted' }),
      makeQuote({ id: 'declined-1', status: 'declined' }),
      makeQuote({ id: 'expired-1', status: 'expired' }),
      makeQuote({ id: 'withdrawn-1', status: 'withdrawn' }),
    ];

    const element = await QuoteCompare({
      quotes,
      locale: 'en',
      currentUserId: '3fa85f64-5717-4562-b3fc-2c963f66cccc',
    });
    render(element);

    const links = screen.getAllByRole('link', { name: 'View full quote' });
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute('href', '/en/quotes/sent-1');
    expect(screen.getByText('€1,575.00')).toBeInTheDocument();
  });

  it('renders nothing when there are no sent quotes', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const QuoteCompare = await loadQuoteCompare();

    const element = await QuoteCompare({
      quotes: [makeQuote({ status: 'draft' })],
      locale: 'en',
      currentUserId: '3fa85f64-5717-4562-b3fc-2c963f66cccc',
    });

    expect(element).toBeNull();
  });
});
