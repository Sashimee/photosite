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

const PHOTOGRAPHER_ID = '3fa85f64-5717-4562-b3fc-2c963f66eeee';
const OTHER_PHOTOGRAPHER_ID = '3fa85f64-5717-4562-b3fc-2c963f66ffff';

const BOOKING = {
  id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  quoteId: '3fa85f64-5717-4562-b3fc-2c963f66aaaa',
  clientId: '3fa85f64-5717-4562-b3fc-2c963f66cccc',
  photographerId: PHOTOGRAPHER_ID,
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

describe('DashboardBookingsPage', () => {
  afterEach(() => {
    vi.resetModules();
    getSessionMock.mockReset();
    apiGetMock.mockReset();
  });

  it('redirects to sign-in with the sanitised next path when signed out', async () => {
    getSessionMock.mockResolvedValue(null);
    const Page = await loadPage();

    const digest = await redirectDigest(
      Page({ params: Promise.resolve({ locale: 'en' }), searchParams: Promise.resolve({}) }),
    );

    expect(digest).toContain(encodeURIComponent('/en/dashboard/bookings'));
  });

  it('redirects to sign-in when the session expires between the check and the fetch', async () => {
    getSessionMock.mockResolvedValue({ id: PHOTOGRAPHER_ID });
    apiGetMock.mockResolvedValue({ data: undefined, response: { status: 401 } });
    const Page = await loadPage();

    const digest = await redirectDigest(
      Page({ params: Promise.resolve({ locale: 'en' }), searchParams: Promise.resolve({}) }),
    );

    expect(digest).toContain(encodeURIComponent('/en/dashboard/bookings'));
  });

  it('throws loudly when the API call fails', async () => {
    getSessionMock.mockResolvedValue({ id: PHOTOGRAPHER_ID });
    apiGetMock.mockResolvedValue({ data: undefined, response: { status: 500 } });
    const Page = await loadPage();

    await expect(
      Page({ params: Promise.resolve({ locale: 'en' }), searchParams: Promise.resolve({}) }),
    ).rejects.toThrow(/HTTP 500/);
  });

  it('only shows bookings where the signed-in user is the photographer', async () => {
    getSessionMock.mockResolvedValue({ id: PHOTOGRAPHER_ID });
    mockApi({
      items: [BOOKING, { ...BOOKING, id: 'other-booking', photographerId: OTHER_PHOTOGRAPHER_ID }],
    });
    const Page = await loadPage();
    const { BookingCard } = await import('@/components/requests/booking-card');

    const element = await Page({
      params: Promise.resolve({ locale: 'en' }),
      searchParams: Promise.resolve({}),
    });
    const children = (element.props as { children: unknown[] }).children;
    const list = children[2] as { props: { children: unknown[] } };
    const cards = list.props.children as { type: unknown; props: { booking: unknown } }[];
    expect(cards).toHaveLength(1);
    const [card] = cards as [{ type: unknown; props: { booking: unknown } }];
    expect(card.type).toBe(BookingCard);
    expect(card.props.booking).toEqual(BOOKING);
  });

  it('shows the empty state when there are no bookings for this photographer', async () => {
    getSessionMock.mockResolvedValue({ id: PHOTOGRAPHER_ID });
    mockApi({ items: [] });
    const Page = await loadPage();

    const element = await Page({
      params: Promise.resolve({ locale: 'en' }),
      searchParams: Promise.resolve({}),
    });
    render(element);

    expect(screen.getByText(translate('web.dashboard.bookings', 'empty'))).toBeInTheDocument();
  });

  it('shows the empty state when every returned booking belongs to a different photographer', async () => {
    getSessionMock.mockResolvedValue({ id: PHOTOGRAPHER_ID });
    mockApi({ items: [{ ...BOOKING, photographerId: OTHER_PHOTOGRAPHER_ID }] });
    const Page = await loadPage();

    const element = await Page({
      params: Promise.resolve({ locale: 'en' }),
      searchParams: Promise.resolve({}),
    });
    render(element);

    expect(screen.getByText(translate('web.dashboard.bookings', 'empty'))).toBeInTheDocument();
  });

  it('shows a next-page link when there is a next cursor', async () => {
    getSessionMock.mockResolvedValue({ id: PHOTOGRAPHER_ID });
    mockApi({ items: [BOOKING], nextCursor: 'cursor-2' });
    const Page = await loadPage();

    const element = await Page({
      params: Promise.resolve({ locale: 'en' }),
      searchParams: Promise.resolve({}),
    });
    const children = (element.props as { children: unknown[] }).children;
    const nextPage = children[3] as { props: { href: string; children: string } };
    expect(nextPage.props.href).toBe('/en/dashboard/bookings?cursor=cursor-2');
    expect(nextPage.props.children).toBe(translate('web.dashboard.bookings', 'loadMore'));
  });

  it('does not show a next-page link once there is no next cursor', async () => {
    getSessionMock.mockResolvedValue({ id: PHOTOGRAPHER_ID });
    mockApi({ items: [BOOKING], nextCursor: null });
    const Page = await loadPage();

    const element = await Page({
      params: Promise.resolve({ locale: 'en' }),
      searchParams: Promise.resolve({}),
    });
    render(element);

    expect(
      screen.queryByRole('link', { name: translate('web.dashboard.bookings', 'loadMore') }),
    ).not.toBeInTheDocument();
  });

  it('does not show a payout figure for the photographer', async () => {
    getSessionMock.mockResolvedValue({ id: PHOTOGRAPHER_ID });
    mockApi({ items: [BOOKING] });
    const Page = await loadPage();

    const element = await Page({
      params: Promise.resolve({ locale: 'en' }),
      searchParams: Promise.resolve({}),
    });
    render(element);

    expect(screen.queryByText(/payout/i)).not.toBeInTheDocument();
  });
});
