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
  return { ...actual, useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) };
});

const OFFER = {
  id: '3fa85f64-5717-4562-b3fc-2c963f66a111',
  slug: 'wedding-photographer-needed',
  title: 'Wedding photographer needed',
  description: 'Full day coverage for a wedding.',
  category: 'wedding',
  city: 'Luxembourg',
  countryCode: 'LU',
  location: { lat: 49.61, lng: 6.13 },
  remote: false,
  startDate: null,
  endDate: null,
  compensation: null,
  status: 'draft',
  publishedAt: null,
  expiresAt: null,
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
    if (url === '/v1/me/professional-profile') {
      return Promise.resolve({ data: profile, response: { status: profileStatus } });
    }
    if (url === '/v1/me/job-offers') {
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

describe('JobOffersPage', () => {
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

    expect(digest).toContain(encodeURIComponent('/en/account/job-offers'));
  });

  it('throws loudly on an unexpected profile lookup failure', async () => {
    getSessionMock.mockResolvedValue({ id: 'user-1' });
    apiGetMock.mockResolvedValue({ data: undefined, response: { status: 500 } });
    const Page = await loadPage();

    await expect(
      Page({ params: Promise.resolve({ locale: 'en' }), searchParams: Promise.resolve({}) }),
    ).rejects.toThrow(/HTTP 500/);
  });

  it('shows a notice to create a professional profile first for a 403 (no role)', async () => {
    getSessionMock.mockResolvedValue({ id: 'user-1' });
    mockApi({ profile: undefined, profileStatus: 403 });
    const Page = await loadPage();

    render(
      await Page({ params: Promise.resolve({ locale: 'en' }), searchParams: Promise.resolve({}) }),
    );

    expect(screen.getByText('Set up your professional profile first')).toBeInTheDocument();
    expect(apiGetMock).not.toHaveBeenCalledWith('/v1/me/job-offers', expect.anything());
  });

  it('shows the same notice for a 404 (role, no profile row)', async () => {
    getSessionMock.mockResolvedValue({ id: 'user-1' });
    mockApi({ profile: undefined, profileStatus: 404 });
    const Page = await loadPage();

    render(
      await Page({ params: Promise.resolve({ locale: 'en' }), searchParams: Promise.resolve({}) }),
    );

    expect(screen.getByText('Set up your professional profile first')).toBeInTheDocument();
  });

  it('throws loudly on an unexpected feed failure', async () => {
    getSessionMock.mockResolvedValue({ id: 'user-1' });
    mockApi({ profile: { id: 'profile-1' }, feedStatus: 500 });
    const Page = await loadPage();

    await expect(
      Page({ params: Promise.resolve({ locale: 'en' }), searchParams: Promise.resolve({}) }),
    ).rejects.toThrow(/HTTP 500/);
  });

  it('shows a distinct empty state for a profile with no offers yet', async () => {
    getSessionMock.mockResolvedValue({ id: 'user-1' });
    mockApi({ profile: { id: 'profile-1' }, feedItems: [] });
    const Page = await loadPage();

    render(
      await Page({ params: Promise.resolve({ locale: 'en' }), searchParams: Promise.resolve({}) }),
    );

    expect(
      screen.getByText('No job offers yet. Post your first one to start receiving applications.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Set up your professional profile first')).not.toBeInTheDocument();
  });

  it('lists offers with status, category, city and edit link', async () => {
    getSessionMock.mockResolvedValue({ id: 'user-1' });
    mockApi({ profile: { id: 'profile-1' }, feedItems: [OFFER] });
    const Page = await loadPage();

    render(
      await Page({ params: Promise.resolve({ locale: 'en' }), searchParams: Promise.resolve({}) }),
    );

    expect(screen.getByText('Wedding photographer needed')).toBeInTheDocument();
    expect(screen.getByText('Draft')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Edit' })).toHaveAttribute(
      'href',
      `/en/account/job-offers/${OFFER.id}/edit`,
    );
  });

  it('shows a remote badge alongside the city for a remote offer', async () => {
    getSessionMock.mockResolvedValue({ id: 'user-1' });
    mockApi({ profile: { id: 'profile-1' }, feedItems: [{ ...OFFER, remote: true }] });
    const Page = await loadPage();

    render(
      await Page({ params: Promise.resolve({ locale: 'en' }), searchParams: Promise.resolve({}) }),
    );

    expect(screen.getByText('Wedding · Remote (Luxembourg, Luxembourg)')).toBeInTheDocument();
  });

  it('links to the next page using the returned cursor', async () => {
    getSessionMock.mockResolvedValue({ id: 'user-1' });
    mockApi({ profile: { id: 'profile-1' }, feedItems: [OFFER], nextCursor: 'cursor-abc' });
    const Page = await loadPage();

    render(
      await Page({ params: Promise.resolve({ locale: 'en' }), searchParams: Promise.resolve({}) }),
    );

    expect(screen.getByRole('link', { name: 'Load more' })).toHaveAttribute(
      'href',
      '/en/account/job-offers?cursor=cursor-abc',
    );
  });
});
