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

const CLIENT_ID = '3fa85f64-5717-4562-b3fc-2c963f66cccc';
const OTHER_CLIENT_ID = '3fa85f64-5717-4562-b3fc-2c963f66dddd';

const BOOKING = {
  id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  quoteId: '3fa85f64-5717-4562-b3fc-2c963f66aaaa',
  clientId: CLIENT_ID,
  photographerId: '3fa85f64-5717-4562-b3fc-2c963f66eeee',
  total: { amountCents: 157500, currency: 'EUR' },
  scheduledAt: '2026-12-01T10:00:00.000Z',
  location: { lat: 49.6116, lng: 6.1319 },
  status: 'pending_payment',
  releaseDueAt: null,
  deliveredAt: null,
  releasedAt: null,
  cancelledAt: null,
  cancellationReason: null,
};

function mockApi({ items, nextCursor = null }: { items: unknown[]; nextCursor?: string | null }) {
  apiGetMock.mockImplementation((url: string) => {
    if (url === '/v1/bookings') {
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

describe('BookingsListPage', () => {
  afterEach(() => {
    vi.resetModules();
    getSessionMock.mockReset();
    apiGetMock.mockReset();
  });

  it('redirects to sign-in with the sanitised next path when signed out', async () => {
    getSessionMock.mockResolvedValue(null);
    const BookingsListPage = await loadPage();

    const digest = await redirectDigest(
      BookingsListPage({
        params: Promise.resolve({ locale: 'en' }),
        searchParams: Promise.resolve({}),
      }),
    );

    expect(digest).toContain(encodeURIComponent('/en/bookings'));
  });

  it('redirects to sign-in when the session expires between the check and the fetch', async () => {
    getSessionMock.mockResolvedValue({ id: CLIENT_ID });
    apiGetMock.mockResolvedValue({ data: undefined, response: { status: 401 } });
    const BookingsListPage = await loadPage();

    const digest = await redirectDigest(
      BookingsListPage({
        params: Promise.resolve({ locale: 'en' }),
        searchParams: Promise.resolve({}),
      }),
    );

    expect(digest).toContain(encodeURIComponent('/en/bookings'));
  });

  it('throws loudly when the API call fails', async () => {
    getSessionMock.mockResolvedValue({ id: CLIENT_ID });
    apiGetMock.mockResolvedValue({ data: undefined, response: { status: 500 } });
    const BookingsListPage = await loadPage();

    await expect(
      BookingsListPage({
        params: Promise.resolve({ locale: 'en' }),
        searchParams: Promise.resolve({}),
      }),
    ).rejects.toThrow(/HTTP 500/);
  });

  it('only shows bookings where the signed-in user is the client', async () => {
    getSessionMock.mockResolvedValue({ id: CLIENT_ID });
    mockApi({ items: [BOOKING, { ...BOOKING, id: 'other-booking', clientId: OTHER_CLIENT_ID }] });
    const BookingsListPage = await loadPage();
    const { BookingCard } = await import('@/components/requests/booking-card');

    const element = await BookingsListPage({
      params: Promise.resolve({ locale: 'en' }),
      searchParams: Promise.resolve({}),
    });
    const children = (element.props as { children: unknown[] }).children;
    const list = children[1] as { props: { children: unknown[] } };
    const cards = list.props.children as { type: unknown; props: { booking: unknown } }[];
    expect(cards).toHaveLength(1);
    const [card] = cards as [{ type: unknown; props: { booking: unknown } }];
    expect(card.type).toBe(BookingCard);
    expect(card.props.booking).toEqual(BOOKING);
  });

  it('shows the empty state when there are no bookings for this client', async () => {
    getSessionMock.mockResolvedValue({ id: CLIENT_ID });
    mockApi({ items: [] });
    const BookingsListPage = await loadPage();

    const element = await BookingsListPage({
      params: Promise.resolve({ locale: 'en' }),
      searchParams: Promise.resolve({}),
    });
    render(element);

    expect(screen.getByText(translate('web.bookings.list', 'empty'))).toBeInTheDocument();
  });

  it('shows the empty state when every returned booking belongs to someone else', async () => {
    getSessionMock.mockResolvedValue({ id: CLIENT_ID });
    mockApi({ items: [{ ...BOOKING, clientId: OTHER_CLIENT_ID }] });
    const BookingsListPage = await loadPage();

    const element = await BookingsListPage({
      params: Promise.resolve({ locale: 'en' }),
      searchParams: Promise.resolve({}),
    });
    render(element);

    expect(screen.getByText(translate('web.bookings.list', 'empty'))).toBeInTheDocument();
  });

  it('shows a next-page link when there is a next cursor', async () => {
    getSessionMock.mockResolvedValue({ id: CLIENT_ID });
    mockApi({ items: [BOOKING], nextCursor: 'cursor-2' });
    const BookingsListPage = await loadPage();

    const element = await BookingsListPage({
      params: Promise.resolve({ locale: 'en' }),
      searchParams: Promise.resolve({}),
    });
    const children = (element.props as { children: unknown[] }).children;
    const nextPage = children[2] as { props: { href: string; children: string } };
    expect(nextPage.props.href).toBe('/en/bookings?cursor=cursor-2');
    expect(nextPage.props.children).toBe(translate('web.bookings.list', 'loadMore'));
  });

  it('does not show a next-page link once there is no next cursor', async () => {
    getSessionMock.mockResolvedValue({ id: CLIENT_ID });
    mockApi({ items: [BOOKING], nextCursor: null });
    const BookingsListPage = await loadPage();

    const element = await BookingsListPage({
      params: Promise.resolve({ locale: 'en' }),
      searchParams: Promise.resolve({}),
    });
    render(element);

    expect(
      screen.queryByRole('link', { name: translate('web.bookings.list', 'loadMore') }),
    ).not.toBeInTheDocument();
  });

  it('passes the cursor from the search params through to the API request', async () => {
    getSessionMock.mockResolvedValue({ id: CLIENT_ID });
    mockApi({ items: [] });
    const BookingsListPage = await loadPage();

    await BookingsListPage({
      params: Promise.resolve({ locale: 'en' }),
      searchParams: Promise.resolve({ cursor: 'cursor-1' }),
    });

    const [, options] = apiGetMock.mock.calls[0] as [
      string,
      { params: { query: { cursor?: string } } },
    ];
    expect(options.params.query.cursor).toBe('cursor-1');
  });
});
