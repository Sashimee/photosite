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

const COUNTRIES = [{ code: 'LU', name: 'Luxembourg', currency: 'EUR', defaultLocale: 'en' }];

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
  jobOffer,
  jobOfferStatus = 200,
  countries = COUNTRIES,
  countriesStatus = 200,
}: {
  profile?: unknown;
  profileStatus?: number;
  jobOffer?: unknown;
  jobOfferStatus?: number;
  countries?: unknown;
  countriesStatus?: number;
}) {
  apiGetMock.mockImplementation((url: string) => {
    if (url === '/v1/me/professional-profile') {
      return Promise.resolve({ data: profile, response: { status: profileStatus } });
    }
    if (url === '/v1/me/job-offers/{id}') {
      return Promise.resolve({
        data: jobOfferStatus === 200 ? jobOffer : undefined,
        response: { status: jobOfferStatus },
      });
    }
    if (url === '/v1/countries') {
      return Promise.resolve({
        data: countriesStatus === 200 ? countries : undefined,
        response: { status: countriesStatus },
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

describe('EditJobOfferPage', () => {
  afterEach(() => {
    vi.resetModules();
    getSessionMock.mockReset();
    apiGetMock.mockReset();
  });

  it('redirects to sign-in when signed out', async () => {
    getSessionMock.mockResolvedValue(null);
    const Page = await loadPage();

    const digest = await redirectDigest(
      Page({ params: Promise.resolve({ locale: 'en', id: OFFER.id }) }),
    );

    expect(digest).toContain(encodeURIComponent(`/en/account/job-offers/${OFFER.id}/edit`));
  });

  it('renders not-found for an offer that does not exist, is expired, closed or was taken down', async () => {
    getSessionMock.mockResolvedValue({ id: 'user-1' });
    mockApi({ profile: { id: 'profile-1' }, jobOfferStatus: 404 });
    const Page = await loadPage();

    const digest = await redirectDigest(
      Page({ params: Promise.resolve({ locale: 'en', id: OFFER.id }) }),
    );

    expect(digest).toMatch(/;404$/);
  });

  it('shows a notice to create a professional profile first when there is none', async () => {
    getSessionMock.mockResolvedValue({ id: 'user-1' });
    mockApi({ profile: undefined, profileStatus: 404, jobOffer: OFFER });
    const Page = await loadPage();

    render(await Page({ params: Promise.resolve({ locale: 'en', id: OFFER.id }) }));

    expect(screen.getByText('Set up your professional profile first')).toBeInTheDocument();
  });

  it('renders the edit form pre-filled from the offer, with its status and actions', async () => {
    getSessionMock.mockResolvedValue({ id: 'user-1' });
    mockApi({ profile: { id: 'profile-1' }, jobOffer: OFFER });
    const Page = await loadPage();

    render(await Page({ params: Promise.resolve({ locale: 'en', id: OFFER.id }) }));

    expect(screen.getByDisplayValue('Wedding photographer needed')).toBeInTheDocument();
    expect(screen.getByText('Draft')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Publish' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });

  it('hides publish and shows close for a published offer', async () => {
    getSessionMock.mockResolvedValue({ id: 'user-1' });
    mockApi({ profile: { id: 'profile-1' }, jobOffer: { ...OFFER, status: 'published' } });
    const Page = await loadPage();

    render(await Page({ params: Promise.resolve({ locale: 'en', id: OFFER.id }) }));

    expect(screen.queryByRole('button', { name: 'Publish' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });
});
