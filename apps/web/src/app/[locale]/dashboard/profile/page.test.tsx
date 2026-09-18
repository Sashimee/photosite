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
vi.mock('next/navigation', async () => {
  const actual = await vi.importActual<typeof import('next/navigation')>('next/navigation');
  return { ...actual, useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) };
});

const COUNTRIES = [{ code: 'LU', name: 'Luxembourg', currency: 'EUR', defaultLocale: 'en' }];

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

function mockApi({ profile, profileStatus = 200 }: { profile?: unknown; profileStatus?: number }) {
  apiGetMock.mockImplementation((url: string) => {
    if (url === '/v1/me/photographer-profile') {
      return Promise.resolve({ data: profile, response: { status: profileStatus } });
    }
    if (url === '/v1/countries') {
      return Promise.resolve({ data: COUNTRIES, response: { status: 200 } });
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

describe('DashboardProfilePage', () => {
  afterEach(() => {
    vi.resetModules();
    getSessionMock.mockReset();
    apiGetMock.mockReset();
  });

  it('redirects to sign-in when signed out', async () => {
    getSessionMock.mockResolvedValue(null);
    const Page = await loadPage();

    const digest = await redirectDigest(Page({ params: Promise.resolve({ locale: 'en' }) }));

    expect(digest).toContain(encodeURIComponent('/en/dashboard/profile'));
  });

  it('throws loudly when countries fail to load', async () => {
    getSessionMock.mockResolvedValue({ id: 'user-1' });
    apiGetMock.mockImplementation((url: string) => {
      if (url === '/v1/me/photographer-profile') {
        return Promise.resolve({ data: undefined, response: { status: 404 } });
      }
      return Promise.resolve({ data: undefined, response: { status: 500 } });
    });
    const Page = await loadPage();

    await expect(Page({ params: Promise.resolve({ locale: 'en' }) })).rejects.toThrow(
      /Failed to load countries/,
    );
  });

  it('shows the create form when there is no profile yet', async () => {
    getSessionMock.mockResolvedValue({ id: 'user-1' });
    mockApi({ profile: undefined, profileStatus: 404 });
    const Page = await loadPage();

    render(await Page({ params: Promise.resolve({ locale: 'en' }) }));

    expect(screen.getByText('Create your photographer profile')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create profile' })).toBeInTheDocument();
  });

  it('shows the edit form pre-filled from an existing profile', async () => {
    getSessionMock.mockResolvedValue({ id: 'user-1' });
    mockApi({ profile: PROFILE });
    const Page = await loadPage();

    render(await Page({ params: Promise.resolve({ locale: 'en' }) }));

    expect(screen.getByText('Edit your profile')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Jane Doe')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View public profile' })).toHaveAttribute(
      'href',
      '/en/photographers/jane-doe',
    );
  });
});
