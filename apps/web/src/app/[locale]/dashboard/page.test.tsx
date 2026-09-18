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

const PROFILE = {
  id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  slug: 'jane-doe',
  displayName: 'Jane Doe',
  headline: null,
  bio: {},
  avatarUrl: null,
  coverUrl: null,
  links: { other: [] },
  categories: ['wedding'],
  languages: ['en'],
  location: { lat: 49.61, lng: 6.13 },
  serviceRadiusKm: null,
  city: 'Luxembourg',
  countryCode: 'LU',
  ratingAvg: 0,
  ratingCount: 0,
  verificationStatus: 'unverified',
  isPublished: false,
  stripeOnboardingComplete: false,
  stripePayoutsEnabled: false,
};

function mockProfile(
  status: number,
  data?: unknown,
  { portfolioItems = [], products = [] }: { portfolioItems?: unknown[]; products?: unknown[] } = {},
) {
  apiGetMock.mockImplementation((url: string) => {
    if (url === '/v1/me/photographer-profile') {
      return Promise.resolve({ data, response: { status } });
    }
    if (url === '/v1/me/photographer-profile/portfolio') {
      return Promise.resolve({
        data: { items: portfolioItems, nextCursor: null },
        response: { status: 200 },
      });
    }
    if (url === '/v1/me/products') {
      return Promise.resolve({ data: products, response: { status: 200 } });
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

describe('DashboardOverviewPage', () => {
  afterEach(() => {
    vi.resetModules();
    getSessionMock.mockReset();
    apiGetMock.mockReset();
  });

  it('redirects to sign-in when signed out', async () => {
    getSessionMock.mockResolvedValue(null);
    const Page = await loadPage();

    const digest = await redirectDigest(Page({ params: Promise.resolve({ locale: 'en' }) }));

    expect(digest).toContain(encodeURIComponent('/en/dashboard'));
  });

  it('redirects to sign-in when the session expires between the check and the fetch', async () => {
    getSessionMock.mockResolvedValue({ id: 'user-1' });
    mockProfile(401);
    const Page = await loadPage();

    const digest = await redirectDigest(Page({ params: Promise.resolve({ locale: 'en' }) }));

    expect(digest).toContain(encodeURIComponent('/en/dashboard'));
  });

  it('throws loudly on an unexpected API failure', async () => {
    getSessionMock.mockResolvedValue({ id: 'user-1' });
    mockProfile(500);
    const Page = await loadPage();

    await expect(Page({ params: Promise.resolve({ locale: 'en' }) })).rejects.toThrow(/HTTP 500/);
  });

  it('shows the profile checklist item as not started, with no profile yet', async () => {
    getSessionMock.mockResolvedValue({ id: 'user-1' });
    mockProfile(404, undefined);
    const Page = await loadPage();

    render(await Page({ params: Promise.resolve({ locale: 'en' }) }));

    expect(screen.getByText('Create your profile below to get started.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Create your profile' })).toHaveAttribute(
      'href',
      '/en/dashboard/profile',
    );
    expect(screen.getAllByText('Not started').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Create your profile first.').length).toBeGreaterThan(0);
  });

  it('reports the portfolio checklist item as not started until there is a photo and a package', async () => {
    getSessionMock.mockResolvedValue({ id: 'user-1' });
    mockProfile(200, PROFILE);
    const Page = await loadPage();

    render(await Page({ params: Promise.resolve({ locale: 'en' }) }));

    expect(screen.getByText('Upload photos and set your packages and prices.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Add photos and packages' })).toHaveAttribute(
      'href',
      '/en/dashboard/portfolio',
    );
  });

  it('reports the portfolio checklist item as done once there is a photo and a package', async () => {
    getSessionMock.mockResolvedValue({ id: 'user-1' });
    mockProfile(200, PROFILE, {
      portfolioItems: [
        { id: 'image-1', url: null, width: null, height: null, order: 1, status: 'processing' },
      ],
      products: [{ id: 'product-1' }],
    });
    const Page = await loadPage();

    render(await Page({ params: Promise.resolve({ locale: 'en' }) }));

    expect(
      screen.getByText("You've uploaded photos and added at least one package."),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Manage portfolio' })).toHaveAttribute(
      'href',
      '/en/dashboard/portfolio',
    );
  });

  it('reports an unpublished profile honestly, without implying this page can publish it', async () => {
    getSessionMock.mockResolvedValue({ id: 'user-1' });
    mockProfile(200, { ...PROFILE, isPublished: false, verificationStatus: 'pending' });
    const Page = await loadPage();

    render(await Page({ params: Promise.resolve({ locale: 'en' }) }));

    expect(screen.getByText("Your profile isn't published yet")).toBeInTheDocument();
    expect(
      screen.getByText(
        'Publishing depends on verification and the other requirements below — nothing on this page publishes it directly.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Submitted, waiting for review.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Edit profile' })).toHaveAttribute(
      'href',
      '/en/dashboard/profile',
    );
  });

  it('shows a published profile as published', async () => {
    getSessionMock.mockResolvedValue({ id: 'user-1' });
    mockProfile(200, { ...PROFILE, isPublished: true, verificationStatus: 'verified' });
    const Page = await loadPage();

    render(await Page({ params: Promise.resolve({ locale: 'en' }) }));

    expect(screen.getByText('Your profile is published')).toBeInTheDocument();
    expect(screen.getByText('Verified.')).toBeInTheDocument();
  });

  it('shows the Stripe payouts row as not available yet rather than omitting it', async () => {
    getSessionMock.mockResolvedValue({ id: 'user-1' });
    mockProfile(200, PROFILE);
    const Page = await loadPage();

    render(await Page({ params: Promise.resolve({ locale: 'en' }) }));

    expect(screen.getByText('Payouts')).toBeInTheDocument();
    expect(screen.getByText('Not available yet.')).toBeInTheDocument();
  });
});
