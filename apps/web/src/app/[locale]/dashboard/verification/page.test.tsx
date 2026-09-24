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

function mockApi({
  profile,
  profileStatus = 200,
  requirements,
  requirementsStatus = 200,
  verificationCase,
  caseStatus = 404,
}: {
  profile?: unknown;
  profileStatus?: number;
  requirements?: unknown;
  requirementsStatus?: number;
  verificationCase?: unknown;
  caseStatus?: number;
}) {
  apiGetMock.mockImplementation((url: string) => {
    if (url === '/v1/me/photographer-profile') {
      return Promise.resolve({ data: profile, response: { status: profileStatus } });
    }
    if (url === '/v1/countries/{code}/verification-requirements') {
      return Promise.resolve({ data: requirements, response: { status: requirementsStatus } });
    }
    if (url === '/v1/me/verification-case') {
      return Promise.resolve({ data: verificationCase, response: { status: caseStatus } });
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

describe('DashboardVerificationPage', () => {
  afterEach(() => {
    vi.resetModules();
    getSessionMock.mockReset();
    apiGetMock.mockReset();
  });

  it('redirects to sign-in when signed out', async () => {
    getSessionMock.mockResolvedValue(null);
    const Page = await loadPage();

    const digest = await redirectDigest(Page({ params: Promise.resolve({ locale: 'en' }) }));

    expect(digest).toContain(encodeURIComponent('/en/dashboard/verification'));
  });

  it('throws loudly on an unexpected profile lookup failure', async () => {
    getSessionMock.mockResolvedValue({ id: 'user-1' });
    apiGetMock.mockResolvedValue({ data: undefined, response: { status: 500 } });
    const Page = await loadPage();

    await expect(Page({ params: Promise.resolve({ locale: 'en' }) })).rejects.toThrow(/HTTP 500/);
  });

  it('shows a notice to create a profile first, without a document list', async () => {
    getSessionMock.mockResolvedValue({ id: 'user-1' });
    mockApi({ profile: undefined, profileStatus: 404 });
    const Page = await loadPage();

    render(await Page({ params: Promise.resolve({ locale: 'en' }) }));

    expect(screen.getByText('Create your profile first')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Create your profile' })).toHaveAttribute(
      'href',
      '/en/dashboard/profile',
    );
  });

  it('shows a country-unavailable notice rather than an error when requirements 404', async () => {
    getSessionMock.mockResolvedValue({ id: 'user-1' });
    mockApi({
      profile: { id: 'profile-1', countryCode: 'ZZ' },
      requirements: undefined,
      requirementsStatus: 404,
    });
    const Page = await loadPage();

    render(await Page({ params: Promise.resolve({ locale: 'en' }) }));

    expect(
      screen.getByText(
        "Verification isn't set up for your profile's country yet. Check back later.",
      ),
    ).toBeInTheDocument();
  });

  it('renders the verification manager once a profile and requirements exist, with no case yet', async () => {
    getSessionMock.mockResolvedValue({ id: 'user-1' });
    mockApi({
      profile: { id: 'profile-1', countryCode: 'LU' },
      requirements: { countryCode: 'LU', documents: [] },
      verificationCase: undefined,
      caseStatus: 404,
    });
    const Page = await loadPage();

    render(await Page({ params: Promise.resolve({ locale: 'en' }) }));

    expect(screen.getByRole('button', { name: 'Start verification' })).toBeInTheDocument();
  });

  it('renders the existing case state when one already exists', async () => {
    getSessionMock.mockResolvedValue({ id: 'user-1' });
    mockApi({
      profile: { id: 'profile-1', countryCode: 'LU' },
      requirements: { countryCode: 'LU', documents: [] },
      verificationCase: {
        id: 'case-1',
        countryCode: 'LU',
        status: 'submitted',
        documents: [],
        submittedAt: '2026-01-01T00:00:00.000Z',
        decidedAt: null,
        rejectionReason: null,
        businessName: 'Acme',
        vatNumber: null,
        businessRegistrationNumber: null,
      },
    });
    const Page = await loadPage();

    render(await Page({ params: Promise.resolve({ locale: 'en' }) }));

    expect(screen.getByText('Submitted, waiting for review')).toBeInTheDocument();
  });
});
