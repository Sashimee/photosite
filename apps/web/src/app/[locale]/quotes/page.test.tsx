import { afterEach, describe, expect, it, vi } from 'vitest';

import { translate } from '@/testing/mock-translations';

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

const QUOTE = {
  id: 'quote-1',
  requestId: 'req-1',
  photographerId: 'photographer-1',
  clientId: 'client-1',
  productId: null,
  productTierId: null,
  lineItems: [{ label: 'Full day coverage', qty: 1, unitCents: 150000 }],
  subtotal: { amountCents: 150000, currency: 'EUR' },
  platformFee: { amountCents: 7500, currency: 'EUR' },
  total: { amountCents: 157500, currency: 'EUR' },
  validUntil: '2026-12-01T00:00:00.000Z',
  message: null,
  status: 'sent',
};

function mockApi({ items, nextCursor = null }: { items: unknown[]; nextCursor?: string | null }) {
  apiGetMock.mockImplementation((url: string) => {
    if (url === '/v1/quotes/mine') {
      return Promise.resolve({ data: { items, nextCursor }, response: { status: 200 } });
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

describe('QuotesListPage', () => {
  afterEach(() => {
    vi.resetModules();
    getSessionMock.mockReset();
    apiGetMock.mockReset();
  });

  it('redirects to sign-in with the sanitised next path when signed out', async () => {
    getSessionMock.mockResolvedValue(null);
    const QuotesListPage = await loadPage();

    const digest = await redirectDigest(
      QuotesListPage({
        params: Promise.resolve({ locale: 'en' }),
        searchParams: Promise.resolve({}),
      }),
    );

    expect(digest).toContain(encodeURIComponent('/en/quotes'));
  });

  it('redirects to sign-in when the session expires between the check and the fetch', async () => {
    getSessionMock.mockResolvedValue({ id: 'user-1' });
    apiGetMock.mockResolvedValue({ data: undefined, response: { status: 401 } });
    const QuotesListPage = await loadPage();

    const digest = await redirectDigest(
      QuotesListPage({
        params: Promise.resolve({ locale: 'en' }),
        searchParams: Promise.resolve({}),
      }),
    );

    expect(digest).toContain(encodeURIComponent('/en/quotes'));
  });

  it('requests only the client role, never mixing in photographer quotes', async () => {
    getSessionMock.mockResolvedValue({ id: 'user-1' });
    mockApi({ items: [] });
    const QuotesListPage = await loadPage();

    await QuotesListPage({
      params: Promise.resolve({ locale: 'en' }),
      searchParams: Promise.resolve({}),
    });

    const [, options] = apiGetMock.mock.calls[0] as [
      string,
      { params: { query: { role: string } } },
    ];
    expect(options.params.query.role).toBe('client');
  });

  it('throws loudly when the API call fails', async () => {
    getSessionMock.mockResolvedValue({ id: 'user-1' });
    apiGetMock.mockResolvedValue({ data: undefined, response: { status: 500 } });
    const QuotesListPage = await loadPage();

    await expect(
      QuotesListPage({
        params: Promise.resolve({ locale: 'en' }),
        searchParams: Promise.resolve({}),
      }),
    ).rejects.toThrow(/HTTP 500/);
  });

  it('lists quotes and shows a next-page link when there is a next cursor', async () => {
    getSessionMock.mockResolvedValue({ id: 'user-1' });
    mockApi({ items: [QUOTE], nextCursor: 'cursor-2' });
    const QuotesListPage = await loadPage();
    const { QuoteCard } = await import('@/components/requests/quote-card');

    const element = await QuotesListPage({
      params: Promise.resolve({ locale: 'en' }),
      searchParams: Promise.resolve({}),
    });
    const children = (element.props as { children: unknown[] }).children;
    const list = children[1] as { props: { children: unknown[] } };
    const [card] = list.props.children as [{ type: unknown; props: { quote: unknown } }];
    expect(card.type).toBe(QuoteCard);
    expect(card.props.quote).toEqual(QUOTE);

    const nextPage = children[2] as { props: { href: string; children: string } };
    expect(nextPage.props.href).toBe('/en/quotes?cursor=cursor-2');
    expect(nextPage.props.children).toBe('Next page');
  });

  it('shows the empty state with no quotes', async () => {
    getSessionMock.mockResolvedValue({ id: 'user-1' });
    mockApi({ items: [] });
    const QuotesListPage = await loadPage();

    const element = await QuotesListPage({
      params: Promise.resolve({ locale: 'en' }),
      searchParams: Promise.resolve({}),
    });
    const children = (element.props as { children: unknown[] }).children;
    const empty = children[1] as { props: { children: string } };
    expect(empty.props.children).toBe("You haven't received any quotes yet.");
  });
});
