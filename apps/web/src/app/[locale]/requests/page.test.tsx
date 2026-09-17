import { render, screen } from '@testing-library/react';
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

const REQUEST_ITEM = {
  id: 'req-1',
  clientId: 'client-1',
  title: 'Wedding photographer needed',
  category: 'wedding',
  description: 'Full day coverage',
  eventDate: '2026-10-01T12:00:00.000Z',
  dateFlexible: false,
  location: { lat: 49.61, lng: 6.13 },
  address: {
    line1: '10 rue de la Gare',
    city: 'Luxembourg',
    postalCode: 'L-1611',
    countryCode: 'LU',
  },
  budgetMin: { amountCents: 100000, currency: 'EUR' },
  budgetMax: { amountCents: 200000, currency: 'EUR' },
  usage: 'personal',
  status: 'open',
  expiresAt: null,
};

function mockApi({
  items,
  nextCursor = null,
  quoteItemsCount = 0,
}: {
  items: unknown[];
  nextCursor?: string | null;
  quoteItemsCount?: number;
}) {
  apiGetMock.mockImplementation((url: string) => {
    if (url === '/v1/requests/mine') {
      return Promise.resolve({ data: { items, nextCursor }, response: { status: 200 } });
    }
    if (url === '/v1/requests/{requestId}/quotes') {
      return Promise.resolve({
        data: { items: Array.from({ length: quoteItemsCount }), nextCursor: null },
        response: { status: 200 },
      });
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

describe('RequestsListPage', () => {
  afterEach(() => {
    vi.resetModules();
    getSessionMock.mockReset();
    apiGetMock.mockReset();
  });

  it('redirects to sign-in with the sanitised next path when signed out', async () => {
    getSessionMock.mockResolvedValue(null);
    const RequestsListPage = await loadPage();

    const digest = await redirectDigest(
      RequestsListPage({
        params: Promise.resolve({ locale: 'en' }),
        searchParams: Promise.resolve({}),
      }),
    );

    expect(digest).toContain(encodeURIComponent('/en/requests'));
  });

  it('redirects to sign-in when the session expires between the check and the fetch', async () => {
    getSessionMock.mockResolvedValue({ id: 'user-1' });
    apiGetMock.mockResolvedValue({ data: undefined, response: { status: 401 } });
    const RequestsListPage = await loadPage();

    const digest = await redirectDigest(
      RequestsListPage({
        params: Promise.resolve({ locale: 'en' }),
        searchParams: Promise.resolve({}),
      }),
    );

    expect(digest).toContain(encodeURIComponent('/en/requests'));
  });

  it('throws loudly when the API call fails', async () => {
    getSessionMock.mockResolvedValue({ id: 'user-1' });
    apiGetMock.mockResolvedValue({ data: undefined, response: { status: 500 } });
    const RequestsListPage = await loadPage();

    await expect(
      RequestsListPage({
        params: Promise.resolve({ locale: 'en' }),
        searchParams: Promise.resolve({}),
      }),
    ).rejects.toThrow(/HTTP 500/);
  });

  it('shows the empty state with no requests', async () => {
    getSessionMock.mockResolvedValue({ id: 'user-1' });
    mockApi({ items: [] });
    const RequestsListPage = await loadPage();

    const element = await RequestsListPage({
      params: Promise.resolve({ locale: 'en' }),
      searchParams: Promise.resolve({}),
    });
    render(element);

    expect(screen.getByText("You haven't sent any requests yet.")).toBeInTheDocument();
  });

  it('lists requests with a status badge and quote count, and a next-page link', async () => {
    getSessionMock.mockResolvedValue({ id: 'user-1' });
    mockApi({ items: [REQUEST_ITEM], nextCursor: 'cursor-2', quoteItemsCount: 3 });
    const RequestsListPage = await loadPage();

    const element = await RequestsListPage({
      params: Promise.resolve({ locale: 'en' }),
      searchParams: Promise.resolve({}),
    });
    render(element);

    const itemLink = screen.getByRole('link', { name: /Wedding photographer needed/ });
    expect(itemLink).toHaveAttribute('href', '/en/requests/req-1');
    expect(screen.getByText(translate('web.requests.status', 'open'))).toBeInTheDocument();
    expect(screen.getByText('3 quotes')).toBeInTheDocument();
    expect(
      screen.getByText(translate('web.requests.list', 'quoteCount', { count: 3 })),
    ).toBeInTheDocument();

    const nextPage = screen.getByRole('link', { name: 'Next page' });
    expect(nextPage).toHaveAttribute('href', '/en/requests?cursor=cursor-2');
  });

  it('resolves the singular and zero plural forms of the quote count literally', async () => {
    getSessionMock.mockResolvedValue({ id: 'user-1' });
    mockApi({ items: [REQUEST_ITEM], quoteItemsCount: 1 });
    const RequestsListPage = await loadPage();

    const element = await RequestsListPage({
      params: Promise.resolve({ locale: 'en' }),
      searchParams: Promise.resolve({}),
    });
    render(element);

    expect(screen.getByText('1 quote')).toBeInTheDocument();
  });

  it('shows "No quotes yet" for a request with zero quotes', async () => {
    getSessionMock.mockResolvedValue({ id: 'user-1' });
    mockApi({ items: [REQUEST_ITEM], quoteItemsCount: 0 });
    const RequestsListPage = await loadPage();

    const element = await RequestsListPage({
      params: Promise.resolve({ locale: 'en' }),
      searchParams: Promise.resolve({}),
    });
    render(element);

    expect(screen.getByText('No quotes yet')).toBeInTheDocument();
  });

  it('does not show a next-page link without a next cursor', async () => {
    getSessionMock.mockResolvedValue({ id: 'user-1' });
    mockApi({ items: [REQUEST_ITEM] });
    const RequestsListPage = await loadPage();

    const element = await RequestsListPage({
      params: Promise.resolve({ locale: 'en' }),
      searchParams: Promise.resolve({}),
    });
    render(element);

    expect(screen.queryByRole('link', { name: 'Next page' })).not.toBeInTheDocument();
  });
});
