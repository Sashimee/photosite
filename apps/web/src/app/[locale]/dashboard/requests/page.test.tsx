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
vi.mock('next-intl', async () => {
  const { mockUseTranslations } = await import('@/testing/mock-translations');
  return { useTranslations: mockUseTranslations };
});
vi.mock('next/navigation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/navigation')>();
  return { ...actual, useRouter: () => ({ push: vi.fn() }) };
});

const FUTURE = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
const PAST = new Date(Date.now() - 1000).toISOString();

const REQUEST_ITEM = {
  id: '3fa85f64-5717-4562-b3fc-2c963f66a111',
  title: 'Wedding in Luxembourg City',
  category: 'wedding',
  description: 'Full day coverage for around 80 guests.',
  eventDate: '2026-08-01T10:00:00.000Z',
  dateFlexible: false,
  city: 'Luxembourg',
  countryCode: 'LU',
  location: { lat: 49.6, lng: 6.1 },
  budgetMin: { amountCents: 100000, currency: 'EUR' },
  budgetMax: { amountCents: 200000, currency: 'EUR' },
  usage: 'personal',
  status: 'open',
  expiresAt: FUTURE,
  hasQuoted: false,
};

function mockApi({
  profile,
  profileStatus = 200,
  feedItems = [],
  feedStatus = 200,
  nextCursor = null,
}: {
  profile?: unknown;
  profileStatus?: number;
  feedItems?: unknown[];
  feedStatus?: number;
  nextCursor?: string | null;
}) {
  apiGetMock.mockImplementation((url: string) => {
    if (url === '/v1/me/photographer-profile') {
      return Promise.resolve({ data: profile, response: { status: profileStatus } });
    }
    if (url === '/v1/requests') {
      return Promise.resolve({
        data: feedStatus === 200 ? { items: feedItems, nextCursor } : undefined,
        response: { status: feedStatus },
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

describe('DashboardRequestsPage', () => {
  afterEach(() => {
    vi.resetModules();
    getSessionMock.mockReset();
    apiGetMock.mockReset();
  });

  it('redirects to sign-in when signed out', async () => {
    getSessionMock.mockResolvedValue(null);
    const Page = await loadPage();

    const digest = await redirectDigest(
      Page({ params: Promise.resolve({ locale: 'en' }), searchParams: Promise.resolve({}) }),
    );

    expect(digest).toContain(encodeURIComponent('/en/dashboard/requests'));
  });

  it('throws loudly on an unexpected profile lookup failure', async () => {
    getSessionMock.mockResolvedValue({ id: 'user-1' });
    apiGetMock.mockResolvedValue({ data: undefined, response: { status: 500 } });
    const Page = await loadPage();

    await expect(
      Page({ params: Promise.resolve({ locale: 'en' }), searchParams: Promise.resolve({}) }),
    ).rejects.toThrow(/HTTP 500/);
  });

  it('shows a notice to create a profile first when there is none', async () => {
    getSessionMock.mockResolvedValue({ id: 'user-1' });
    mockApi({ profile: undefined, profileStatus: 404 });
    const Page = await loadPage();

    render(
      await Page({ params: Promise.resolve({ locale: 'en' }), searchParams: Promise.resolve({}) }),
    );

    expect(screen.getByText('Create your profile first')).toBeInTheDocument();
    expect(apiGetMock).not.toHaveBeenCalledWith('/v1/requests', expect.anything());
  });

  it('shows a notice that the profile must be published, without fetching the feed', async () => {
    getSessionMock.mockResolvedValue({ id: 'user-1' });
    mockApi({ profile: { id: 'profile-1', isPublished: false } });
    const Page = await loadPage();

    render(
      await Page({ params: Promise.resolve({ locale: 'en' }), searchParams: Promise.resolve({}) }),
    );

    expect(screen.getByText("Your profile isn't published yet")).toBeInTheDocument();
    expect(apiGetMock).not.toHaveBeenCalledWith('/v1/requests', expect.anything());
  });

  it('throws loudly on an unexpected feed failure', async () => {
    getSessionMock.mockResolvedValue({ id: 'user-1' });
    mockApi({ profile: { id: 'profile-1', isPublished: true }, feedStatus: 500 });
    const Page = await loadPage();

    await expect(
      Page({ params: Promise.resolve({ locale: 'en' }), searchParams: Promise.resolve({}) }),
    ).rejects.toThrow(/HTTP 500/);
  });

  it('shows the empty state when nothing matches', async () => {
    getSessionMock.mockResolvedValue({ id: 'user-1' });
    mockApi({ profile: { id: 'profile-1', isPublished: true }, feedItems: [] });
    const Page = await loadPage();

    render(
      await Page({ params: Promise.resolve({ locale: 'en' }), searchParams: Promise.resolve({}) }),
    );

    expect(
      screen.getByText('No requests are matching your categories and location right now.'),
    ).toBeInTheDocument();
  });

  it('offers to send a quote for an open, unquoted request', async () => {
    getSessionMock.mockResolvedValue({ id: 'user-1' });
    mockApi({ profile: { id: 'profile-1', isPublished: true }, feedItems: [REQUEST_ITEM] });
    const Page = await loadPage();

    render(
      await Page({ params: Promise.resolve({ locale: 'en' }), searchParams: Promise.resolve({}) }),
    );

    expect(screen.getByRole('button', { name: 'Send a quote' })).toBeInTheDocument();
  });

  it('shows an already-quoted notice instead of the send-quote trigger', async () => {
    getSessionMock.mockResolvedValue({ id: 'user-1' });
    mockApi({
      profile: { id: 'profile-1', isPublished: true },
      feedItems: [{ ...REQUEST_ITEM, hasQuoted: true }],
    });
    const Page = await loadPage();

    render(
      await Page({ params: Promise.resolve({ locale: 'en' }), searchParams: Promise.resolve({}) }),
    );

    expect(screen.queryByRole('button', { name: 'Send a quote' })).not.toBeInTheDocument();
    expect(screen.getByText("You've already sent a quote for this request.")).toBeInTheDocument();
  });

  it('shows an expired notice instead of the send-quote trigger once expiresAt has passed', async () => {
    getSessionMock.mockResolvedValue({ id: 'user-1' });
    mockApi({
      profile: { id: 'profile-1', isPublished: true },
      feedItems: [{ ...REQUEST_ITEM, expiresAt: PAST }],
    });
    const Page = await loadPage();

    render(
      await Page({ params: Promise.resolve({ locale: 'en' }), searchParams: Promise.resolve({}) }),
    );

    expect(screen.queryByRole('button', { name: 'Send a quote' })).not.toBeInTheDocument();
    expect(screen.getByText('This request is no longer accepting quotes.')).toBeInTheDocument();
  });

  it('links to the next page using the returned cursor', async () => {
    getSessionMock.mockResolvedValue({ id: 'user-1' });
    mockApi({
      profile: { id: 'profile-1', isPublished: true },
      feedItems: [REQUEST_ITEM],
      nextCursor: 'cursor-abc',
    });
    const Page = await loadPage();

    render(
      await Page({ params: Promise.resolve({ locale: 'en' }), searchParams: Promise.resolve({}) }),
    );

    expect(screen.getByRole('link', { name: 'Next page' })).toHaveAttribute(
      'href',
      '/en/dashboard/requests?cursor=cursor-abc',
    );
  });
});
