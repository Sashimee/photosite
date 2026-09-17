import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { translate } from '@/testing/mock-translations';

const QUOTE_ID = '3fa85f64-5717-4562-b3fc-2c963f66a222';
const REQUEST_ID = '3fa85f64-5717-4562-b3fc-2c963f66a111';

const getSessionMock = vi.fn();
const apiGetMock = vi.fn();

vi.mock('@/lib/session', () => ({
  getSession: getSessionMock,
  serverApi: vi.fn().mockResolvedValue({ GET: apiGetMock }),
}));
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
vi.mock('next/navigation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/navigation')>();
  return { ...actual, useRouter: () => ({ refresh: vi.fn() }) };
});

const QUOTE = {
  id: QUOTE_ID,
  requestId: REQUEST_ID,
  photographerId: 'photographer-1',
  clientId: 'client-1',
  productId: null,
  productTierId: null,
  lineItems: [{ label: 'Full day coverage', qty: 1, unitCents: 150000 }],
  subtotal: { amountCents: 150000, currency: 'EUR' },
  platformFee: { amountCents: 7500, currency: 'EUR' },
  total: { amountCents: 157500, currency: 'EUR' },
  validUntil: '2026-12-01T00:00:00.000Z',
  message: 'Looking forward to it!',
  status: 'sent',
};

function mockApi({ data, status = 200 }: { data?: unknown; status?: number }) {
  apiGetMock.mockImplementation((url: string) => {
    if (url === '/v1/quotes/{id}') {
      return Promise.resolve({ data, response: { status } });
    }
    throw new Error(`unexpected GET ${url}`);
  });
}

async function loadPage() {
  const mod = await import('./page');
  return mod.default;
}

async function redirectDigest(promise: Promise<unknown>): Promise<string | undefined> {
  const error: unknown = await promise.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(Error);
  return (error as { digest?: string }).digest;
}

describe('QuoteDetailPage', () => {
  afterEach(() => {
    vi.resetModules();
    getSessionMock.mockReset();
    apiGetMock.mockReset();
  });

  it('redirects to sign-in with the sanitised next path when signed out', async () => {
    getSessionMock.mockResolvedValue(null);
    const QuoteDetailPage = await loadPage();

    const digest = await redirectDigest(
      QuoteDetailPage({ params: Promise.resolve({ locale: 'en', id: QUOTE_ID }) }),
    );

    expect(digest).toContain(encodeURIComponent(`/en/quotes/${QUOTE_ID}`));
  });

  it('renders notFound when the id is not a valid identifier', async () => {
    getSessionMock.mockResolvedValue({ id: 'client-1' });
    const QuoteDetailPage = await loadPage();

    const digest = await redirectDigest(
      QuoteDetailPage({ params: Promise.resolve({ locale: 'en', id: 'not-a-uuid' }) }),
    );

    expect(digest).toMatch(/;404$/);
    expect(apiGetMock).not.toHaveBeenCalled();
  });

  it('renders notFound when the quote does not exist', async () => {
    getSessionMock.mockResolvedValue({ id: 'client-1' });
    mockApi({ status: 404 });
    const QuoteDetailPage = await loadPage();

    const digest = await redirectDigest(
      QuoteDetailPage({ params: Promise.resolve({ locale: 'en', id: QUOTE_ID }) }),
    );

    expect(digest).toMatch(/;404$/);
  });

  it('renders notFound on a 403, the same as a 404', async () => {
    getSessionMock.mockResolvedValue({ id: 'client-1' });
    mockApi({ status: 403 });
    const QuoteDetailPage = await loadPage();

    const digest = await redirectDigest(
      QuoteDetailPage({ params: Promise.resolve({ locale: 'en', id: QUOTE_ID }) }),
    );

    expect(digest).toMatch(/;404$/);
  });

  it('redirects to sign-in when the session expires between the check and the fetch', async () => {
    getSessionMock.mockResolvedValue({ id: 'client-1' });
    mockApi({ status: 401 });
    const QuoteDetailPage = await loadPage();

    const digest = await redirectDigest(
      QuoteDetailPage({ params: Promise.resolve({ locale: 'en', id: QUOTE_ID }) }),
    );

    expect(digest).toContain(encodeURIComponent(`/en/quotes/${QUOTE_ID}`));
  });

  it('throws loudly when the API call fails unexpectedly', async () => {
    getSessionMock.mockResolvedValue({ id: 'client-1' });
    mockApi({ status: 500 });
    const QuoteDetailPage = await loadPage();

    await expect(
      QuoteDetailPage({ params: Promise.resolve({ locale: 'en', id: QUOTE_ID }) }),
    ).rejects.toThrow(/HTTP 500/);
  });

  it('links back to the request when the quote has one', async () => {
    getSessionMock.mockResolvedValue({ id: 'client-1' });
    mockApi({ data: QUOTE });
    const QuoteDetailPage = await loadPage();

    const element = await QuoteDetailPage({
      params: Promise.resolve({ locale: 'en', id: QUOTE_ID }),
    });
    render(element);

    expect(screen.getByRole('link', { name: 'Back to request' })).toHaveAttribute(
      'href',
      `/en/requests/${REQUEST_ID}`,
    );
    expect(screen.getByRole('heading', { level: 1, name: '€1,575.00' })).toBeInTheDocument();
    expect(screen.getByText('Looking forward to it!')).toBeInTheDocument();
    expect(screen.getByText(/Valid until/)).toBeInTheDocument();
  });

  it('links back to the quotes list for a direct quote with no request', async () => {
    getSessionMock.mockResolvedValue({ id: 'client-1' });
    mockApi({ data: { ...QUOTE, requestId: null } });
    const QuoteDetailPage = await loadPage();

    const element = await QuoteDetailPage({
      params: Promise.resolve({ locale: 'en', id: QUOTE_ID }),
    });
    render(element);

    expect(screen.getByRole('link', { name: 'Back to quotes' })).toHaveAttribute(
      'href',
      '/en/quotes',
    );
  });

  it('shows the accepted notice once the quote is accepted', async () => {
    getSessionMock.mockResolvedValue({ id: 'client-1' });
    mockApi({ data: { ...QUOTE, status: 'accepted' } });
    const QuoteDetailPage = await loadPage();

    const element = await QuoteDetailPage({
      params: Promise.resolve({ locale: 'en', id: QUOTE_ID }),
    });
    render(element);

    expect(
      screen.getByText(
        "Quote accepted. Booking and payment are coming soon — we'll be in touch with next steps.",
      ),
    ).toBeInTheDocument();
  });

  it('only shows quote actions to the quote’s own client', async () => {
    getSessionMock.mockResolvedValue({ id: 'someone-else' });
    mockApi({ data: QUOTE });
    const QuoteDetailPage = await loadPage();

    const element = await QuoteDetailPage({
      params: Promise.resolve({ locale: 'en', id: QUOTE_ID }),
    });
    render(element);

    expect(
      screen.queryByRole('button', { name: translate('web.quotes.detail', 'acceptCta') }),
    ).not.toBeInTheDocument();
  });
});
