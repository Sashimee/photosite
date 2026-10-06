import { render, screen, within } from '@testing-library/react';
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

const BOOKING_ID = '3fa85f64-5717-4562-b3fc-2c963f66afa6';
const OTHER_BOOKING_ID = '4fa85f64-5717-4562-b3fc-2c963f66afa7';

function mockEarnings(status: number, data?: unknown, error?: unknown) {
  apiGetMock.mockImplementation((url: string) => {
    if (url === '/v1/me/earnings') {
      return Promise.resolve({ data, error, response: { status } });
    }
    throw new Error(`unexpected GET ${url}`);
  });
}

async function loadPage() {
  const mod = await import('./page');
  return mod.default;
}

async function loadMetadata() {
  const mod = await import('./page');
  return mod.generateMetadata;
}

async function redirectDigest(promise: Promise<unknown>): Promise<string | undefined> {
  const error: unknown = await promise.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(Error);
  return (error as { digest?: string }).digest;
}

async function renderPage() {
  const Page = await loadPage();
  render(await Page({ params: Promise.resolve({ locale: 'en' }) }));
}

describe('DashboardEarningsPage', () => {
  afterEach(() => {
    vi.resetModules();
    getSessionMock.mockReset();
    apiGetMock.mockReset();
  });

  it('shows the empty state when there are no totals and no recent entries', async () => {
    getSessionMock.mockResolvedValue({ id: 'user-1' });
    mockEarnings(200, { totals: [], recent: [] });

    await renderPage();

    expect(screen.getByText('No earnings yet')).toBeInTheDocument();
    expect(screen.queryByText('Released to your Stripe account')).not.toBeInTheDocument();
    expect(screen.queryByText('Recent activity')).not.toBeInTheDocument();
  });

  it('shows released and held figures for one currency and links recent bookings', async () => {
    getSessionMock.mockResolvedValue({ id: 'user-1' });
    mockEarnings(200, {
      totals: [{ currency: 'EUR', releasedCents: 123456, heldCents: 7800 }],
      recent: [
        {
          bookingId: BOOKING_ID,
          amountCents: 9500,
          currency: 'EUR',
          occurredAt: '2026-10-01T10:00:00.000Z',
        },
      ],
    });

    await renderPage();

    expect(screen.getByText('Released to your Stripe account')).toBeInTheDocument();
    expect(screen.getByText('Held until delivery is accepted')).toBeInTheDocument();
    expect(screen.getByText('€1,234.56')).toBeInTheDocument();
    expect(screen.getByText('€78.00')).toBeInTheDocument();
    expect(screen.getByText('€95.00')).toBeInTheDocument();
    expect(
      screen.getByText(/Stripe then pays it to your bank on your payout schedule/),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View booking' })).toHaveAttribute(
      'href',
      `/en/dashboard/bookings/${BOOKING_ID}`,
    );
    expect(screen.queryByText('No earnings yet')).not.toBeInTheDocument();
  });

  it('keeps two currencies apart', async () => {
    getSessionMock.mockResolvedValue({ id: 'user-1' });
    mockEarnings(200, {
      totals: [
        { currency: 'EUR', releasedCents: 10000, heldCents: 2500 },
        { currency: 'USD', releasedCents: 5000, heldCents: 0 },
      ],
      recent: [
        {
          bookingId: BOOKING_ID,
          amountCents: 10000,
          currency: 'EUR',
          occurredAt: '2026-10-01T10:00:00.000Z',
        },
        {
          bookingId: OTHER_BOOKING_ID,
          amountCents: 5000,
          currency: 'USD',
          occurredAt: '2026-09-30T10:00:00.000Z',
        },
      ],
    });

    await renderPage();

    const rows = screen
      .getAllByText('Released to your Stripe account')
      .map((label) => within(label.closest('li') as HTMLElement));
    expect(rows).toHaveLength(2);
    expect(rows[0]?.getByText('€100.00')).toBeInTheDocument();
    expect(rows[0]?.getByText('€25.00')).toBeInTheDocument();
    expect(rows[1]?.getByText('$50.00')).toBeInTheDocument();
    expect(rows[1]?.getByText('$0.00')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'View booking' })).toHaveLength(2);
  });

  it('shows a held-only currency with zero released and no recent section', async () => {
    getSessionMock.mockResolvedValue({ id: 'user-1' });
    mockEarnings(200, {
      totals: [{ currency: 'EUR', releasedCents: 0, heldCents: 9500 }],
      recent: [],
    });

    await renderPage();

    const row = within(
      screen.getByText('Released to your Stripe account').closest('li') as HTMLElement,
    );
    expect(row.getByText('€0.00')).toBeInTheDocument();
    expect(row.getByText('€95.00')).toBeInTheDocument();
    expect(screen.queryByText('No earnings yet')).not.toBeInTheDocument();
    expect(screen.queryByText('Recent activity')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'View booking' })).not.toBeInTheDocument();
  });

  it('shows a rate-limit message with the retry delay on 429', async () => {
    getSessionMock.mockResolvedValue({ id: 'user-1' });
    mockEarnings(429, undefined, {
      code: 'TOO_MANY_REQUESTS',
      details: { retryAfterSeconds: 30 },
    });

    await renderPage();

    expect(screen.getByText(/Try again in 30 seconds/)).toBeInTheDocument();
    expect(screen.queryByText('Released to your Stripe account')).not.toBeInTheDocument();
  });

  it('shows the forbidden message on 403', async () => {
    getSessionMock.mockResolvedValue({ id: 'user-1' });
    mockEarnings(403, undefined, { code: 'FORBIDDEN' });

    await renderPage();

    expect(screen.getByText('Only photographers can see earnings.')).toBeInTheDocument();
    expect(screen.queryByText('No earnings yet')).not.toBeInTheDocument();
  });

  it('throws loudly on an unexpected status', async () => {
    getSessionMock.mockResolvedValue({ id: 'user-1' });
    mockEarnings(500);
    const Page = await loadPage();

    await expect(Page({ params: Promise.resolve({ locale: 'en' }) })).rejects.toThrow(/HTTP 500/);
  });

  it('redirects to sign-in with the earnings path when signed out', async () => {
    getSessionMock.mockResolvedValue(null);
    const Page = await loadPage();

    const digest = await redirectDigest(Page({ params: Promise.resolve({ locale: 'en' }) }));

    expect(digest).toContain(encodeURIComponent('/en/dashboard/earnings'));
    expect(apiGetMock).not.toHaveBeenCalled();
  });

  it('redirects to sign-in when the session expires between the check and the fetch', async () => {
    getSessionMock.mockResolvedValue({ id: 'user-1' });
    mockEarnings(401);
    const Page = await loadPage();

    const digest = await redirectDigest(Page({ params: Promise.resolve({ locale: 'en' }) }));

    expect(digest).toContain(encodeURIComponent('/en/dashboard/earnings'));
  });

  it('renders not found for an unknown locale without calling the api', async () => {
    const Page = await loadPage();

    const digest = await redirectDigest(Page({ params: Promise.resolve({ locale: 'xx' }) }));

    expect(digest).toContain('NEXT_HTTP_ERROR_FALLBACK;404');
    expect(getSessionMock).not.toHaveBeenCalled();
    expect(apiGetMock).not.toHaveBeenCalled();
  });

  it('marks the page noindex with a translated title', async () => {
    const generateMetadata = await loadMetadata();

    const metadata = await generateMetadata({ params: Promise.resolve({ locale: 'en' }) });

    expect(metadata.robots).toEqual({ index: false, follow: false });
    expect(metadata.title).toBe(translate('web.dashboard.earnings', 'metaTitle'));
  });

  it('returns empty metadata for an unknown locale', async () => {
    const generateMetadata = await loadMetadata();

    expect(await generateMetadata({ params: Promise.resolve({ locale: 'xx' }) })).toEqual({});
  });
});
