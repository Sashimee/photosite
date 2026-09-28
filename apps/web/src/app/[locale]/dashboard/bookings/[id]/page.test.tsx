import { render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { translate } from '@/testing/mock-translations';

const BOOKING_ID = '3fa85f64-5717-4562-b3fc-2c963f66afa6';
const USER_ID = '3fa85f64-5717-4562-b3fc-2c963f66d001';
const PROFILE_ID = '3fa85f64-5717-4562-b3fc-2c963f66eeee';
const OTHER_PROFILE_ID = '3fa85f64-5717-4562-b3fc-2c963f66ffff';

const getSessionMock = vi.fn();
const apiGetMock = vi.fn();

vi.mock('@/lib/session', () => ({
  getSession: getSessionMock,
  serverApi: vi.fn().mockResolvedValue({ GET: apiGetMock }),
}));
vi.mock('next/navigation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/navigation')>();
  return { ...actual, useRouter: () => ({ refresh: vi.fn() }) };
});
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
vi.mock('@/components/requests/booking-status-timeline', () => ({
  BookingStatusTimeline: ({ status }: { status: string }) => (
    <div data-testid="booking-status-timeline" data-status={status} />
  ),
}));

const BOOKING = {
  id: BOOKING_ID,
  quoteId: '3fa85f64-5717-4562-b3fc-2c963f66aaaa',
  clientId: '3fa85f64-5717-4562-b3fc-2c963f66cccc',
  photographerId: PROFILE_ID,
  total: { amountCents: 157500, currency: 'EUR' },
  scheduledAt: '2026-12-01T10:00:00.000Z',
  location: { lat: 49.6116, lng: 6.1319 },
  status: 'pending_payment' as const,
  releaseDueAt: null,
  deliveredAt: null,
  releasedAt: null,
  cancelledAt: null,
  cancellationReason: null,
};

function mockApi({
  data,
  status = 200,
  profileId = PROFILE_ID,
  profileStatus = 200,
}: {
  data?: unknown;
  status?: number;
  profileId?: string | null;
  profileStatus?: number;
}) {
  apiGetMock.mockImplementation((url: string) => {
    if (url === '/v1/bookings/{id}') {
      return Promise.resolve({ data, response: { status } });
    }
    if (url === '/v1/me/photographer-profile') {
      return profileStatus === 200
        ? Promise.resolve({ data: { id: profileId }, response: { status: profileStatus } })
        : Promise.resolve({ data: undefined, response: { status: profileStatus } });
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

async function renderResolved(element: ReactElement) {
  const Component = element.type as (props: unknown) => Promise<ReactElement>;
  render(await Component(element.props));
}

describe('DashboardBookingDetailPage', () => {
  afterEach(() => {
    vi.resetModules();
    getSessionMock.mockReset();
    apiGetMock.mockReset();
  });

  it('renders notFound when the id is not a valid identifier', async () => {
    getSessionMock.mockResolvedValue({ id: USER_ID });
    const Page = await loadPage();

    const digest = await redirectDigest(
      Page({ params: Promise.resolve({ locale: 'en', id: 'not-a-uuid' }) }),
    );

    expect(digest).toMatch(/;404$/);
    expect(apiGetMock).not.toHaveBeenCalled();
  });

  it('redirects to sign-in with the sanitised next path when signed out', async () => {
    getSessionMock.mockResolvedValue(null);
    const Page = await loadPage();

    const digest = await redirectDigest(
      Page({ params: Promise.resolve({ locale: 'en', id: BOOKING_ID }) }),
    );

    expect(digest).toContain(encodeURIComponent(`/en/dashboard/bookings/${BOOKING_ID}`));
  });

  it('redirects to sign-in when the session expires between the check and the fetch', async () => {
    getSessionMock.mockResolvedValue({ id: USER_ID });
    mockApi({ status: 401 });
    const Page = await loadPage();

    const digest = await redirectDigest(
      Page({ params: Promise.resolve({ locale: 'en', id: BOOKING_ID }) }),
    );

    expect(digest).toContain(encodeURIComponent(`/en/dashboard/bookings/${BOOKING_ID}`));
  });

  it('renders notFound when the booking does not exist', async () => {
    getSessionMock.mockResolvedValue({ id: USER_ID });
    mockApi({ status: 404 });
    const Page = await loadPage();

    const digest = await redirectDigest(
      Page({ params: Promise.resolve({ locale: 'en', id: BOOKING_ID }) }),
    );

    expect(digest).toMatch(/;404$/);
  });

  it('renders notFound on a 403, the same as a 404', async () => {
    getSessionMock.mockResolvedValue({ id: USER_ID });
    mockApi({ status: 403 });
    const Page = await loadPage();

    const digest = await redirectDigest(
      Page({ params: Promise.resolve({ locale: 'en', id: BOOKING_ID }) }),
    );

    expect(digest).toMatch(/;404$/);
  });

  it('renders notFound when the booking belongs to a different photographer profile', async () => {
    getSessionMock.mockResolvedValue({ id: USER_ID });
    mockApi({ data: BOOKING, profileId: OTHER_PROFILE_ID });
    const Page = await loadPage();

    const digest = await redirectDigest(
      Page({ params: Promise.resolve({ locale: 'en', id: BOOKING_ID }) }),
    );

    expect(digest).toMatch(/;404$/);
  });

  it('renders the booking when photographerId matches the profile id even though it differs from the session user id', async () => {
    getSessionMock.mockResolvedValue({ id: USER_ID });
    mockApi({ data: BOOKING });
    const Page = await loadPage();

    const element = await Page({ params: Promise.resolve({ locale: 'en', id: BOOKING_ID }) });
    await renderResolved(element);

    expect(screen.getByRole('heading', { level: 1, name: '€1,575.00' })).toBeInTheDocument();
  });

  it('renders notFound when the booking’s photographerId matches the session user id but not the profile id', async () => {
    getSessionMock.mockResolvedValue({ id: USER_ID });
    mockApi({ data: { ...BOOKING, photographerId: USER_ID }, profileId: PROFILE_ID });
    const Page = await loadPage();

    const digest = await redirectDigest(
      Page({ params: Promise.resolve({ locale: 'en', id: BOOKING_ID }) }),
    );

    expect(digest).toMatch(/;404$/);
  });

  it('throws loudly when the API call fails unexpectedly', async () => {
    getSessionMock.mockResolvedValue({ id: USER_ID });
    mockApi({ status: 500 });
    const Page = await loadPage();

    await expect(
      Page({ params: Promise.resolve({ locale: 'en', id: BOOKING_ID }) }),
    ).rejects.toThrow(/HTTP 500/);
  });

  it('does not render any checkout UI for the photographer', async () => {
    getSessionMock.mockResolvedValue({ id: USER_ID });
    mockApi({ data: BOOKING });
    const Page = await loadPage();

    const element = await Page({ params: Promise.resolve({ locale: 'en', id: BOOKING_ID }) });
    await renderResolved(element);

    expect(screen.queryByTestId('booking-checkout')).not.toBeInTheDocument();
  });

  it('does not show a payout figure for the photographer', async () => {
    getSessionMock.mockResolvedValue({ id: USER_ID });
    mockApi({ data: BOOKING });
    const Page = await loadPage();

    const element = await Page({ params: Promise.resolve({ locale: 'en', id: BOOKING_ID }) });
    await renderResolved(element);

    expect(screen.queryByText(/payout/i)).not.toBeInTheDocument();
  });

  it('links back to the dashboard bookings list and shows the total', async () => {
    getSessionMock.mockResolvedValue({ id: USER_ID });
    mockApi({ data: BOOKING });
    const Page = await loadPage();

    const element = await Page({ params: Promise.resolve({ locale: 'en', id: BOOKING_ID }) });
    await renderResolved(element);

    expect(
      screen.getByRole('link', { name: translate('web.bookings.detail', 'backToList') }),
    ).toHaveAttribute('href', '/en/dashboard/bookings');
    expect(screen.getByRole('heading', { level: 1, name: '€1,575.00' })).toBeInTheDocument();
  });
});
