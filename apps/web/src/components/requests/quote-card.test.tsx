import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { translate } from '@/testing/mock-translations';

vi.mock('next-intl/server', () => ({
  getTranslations:
    ({ namespace }: { namespace: string }) =>
    (key: string, values?: Record<string, unknown>) =>
      translate(namespace, key, values),
}));

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
  message: 'Looking forward to it!',
  status: 'sent' as const,
};

describe('QuoteCard', () => {
  it('links to the quote detail page and shows the total and message', async () => {
    const { QuoteCard } = await import('./quote-card');
    const element = await QuoteCard({ quote: baseQuote, locale: 'en' });
    render(element);

    expect(screen.getByRole('link')).toHaveAttribute('href', `/en/quotes/${baseQuote.id}`);
    expect(screen.getByText('€1,575.00')).toBeInTheDocument();
    expect(screen.getByText('Looking forward to it!')).toBeInTheDocument();
    expect(screen.getByText(translate('web.quotes.status', 'sent'))).toBeInTheDocument();
  });

  it('throws loudly instead of rendering a quote with no total', async () => {
    const { QuoteCard } = await import('./quote-card');
    await expect(
      QuoteCard({ quote: { ...baseQuote, total: null }, locale: 'en' }),
    ).rejects.toThrow();
  });
});
