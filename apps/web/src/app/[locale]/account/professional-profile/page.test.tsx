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

const PROFILE = {
  id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  companyName: 'Acme Studios',
  website: null,
  logoUrl: null,
  verified: false,
  vatNumber: null,
};

function baseUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user-1',
    email: 'jane@example.com',
    emailVerifiedAt: '2026-01-01T00:00:00.000Z',
    locale: 'en',
    country: 'LU',
    roles: ['client'],
    status: 'active',
    twoFactorEnabled: false,
    lastLoginAt: null,
    ...overrides,
  };
}

function mockProfile(status: number, data?: unknown) {
  apiGetMock.mockImplementation((url: string) => {
    if (url === '/v1/me/professional-profile') {
      return Promise.resolve({ data, response: { status } });
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

describe('ProfessionalProfilePage', () => {
  afterEach(() => {
    vi.resetModules();
    getSessionMock.mockReset();
    apiGetMock.mockReset();
  });

  it('redirects to sign-in when signed out', async () => {
    getSessionMock.mockResolvedValue(null);
    const Page = await loadPage();

    const digest = await redirectDigest(Page({ params: Promise.resolve({ locale: 'en' }) }));

    expect(digest).toContain(encodeURIComponent('/en/account/professional-profile'));
  });

  it('redirects to sign-in when the session cookie is invalid', async () => {
    getSessionMock.mockResolvedValue(baseUser());
    mockProfile(401);
    const Page = await loadPage();

    const digest = await redirectDigest(Page({ params: Promise.resolve({ locale: 'en' }) }));

    expect(digest).toContain(encodeURIComponent('/en/account/professional-profile'));
  });

  it('throws loudly on an unexpected server error', async () => {
    getSessionMock.mockResolvedValue(baseUser());
    mockProfile(500);
    const Page = await loadPage();

    await expect(Page({ params: Promise.resolve({ locale: 'en' }) })).rejects.toThrow(
      /Failed to load the professional profile/,
    );
  });

  it('shows the create form for an account with no professional role at all (403 FORBIDDEN)', async () => {
    getSessionMock.mockResolvedValue(baseUser());
    mockProfile(403, { code: 'FORBIDDEN' });
    const Page = await loadPage();

    render(await Page({ params: Promise.resolve({ locale: 'en' }) }));

    expect(screen.getByText('Create your professional profile')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create profile' })).toBeInTheDocument();
  });

  it('shows the exact same create form for an account that already has the role but no profile row (404)', async () => {
    getSessionMock.mockResolvedValue(baseUser({ roles: ['client', 'professional'] }));
    mockProfile(404, { code: 'NOT_FOUND' });
    const Page = await loadPage();

    render(await Page({ params: Promise.resolve({ locale: 'en' }) }));

    expect(screen.getByText('Create your professional profile')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create profile' })).toBeInTheDocument();
  });

  it('shows the edit form when a profile already exists', async () => {
    getSessionMock.mockResolvedValue(baseUser({ roles: ['client', 'professional'] }));
    mockProfile(200, PROFILE);
    const Page = await loadPage();

    render(await Page({ params: Promise.resolve({ locale: 'en' }) }));

    expect(screen.getByText('Edit your professional profile')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Acme Studios')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeInTheDocument();
  });

  it('shows the email-verification prompt instead of the create form for an unverified email, without ever calling create', async () => {
    getSessionMock.mockResolvedValue(baseUser({ emailVerifiedAt: null }));
    mockProfile(403, { code: 'FORBIDDEN' });
    const Page = await loadPage();

    render(await Page({ params: Promise.resolve({ locale: 'en' }) }));

    expect(screen.getByRole('button', { name: 'Resend verification email' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create profile' })).not.toBeInTheDocument();
  });

  it('still shows the edit form for an unverified email once a profile exists, since editing does not require verification', async () => {
    getSessionMock.mockResolvedValue(baseUser({ emailVerifiedAt: null, roles: ['professional'] }));
    mockProfile(200, PROFILE);
    const Page = await loadPage();

    render(await Page({ params: Promise.resolve({ locale: 'en' }) }));

    expect(screen.getByRole('button', { name: 'Save changes' })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Resend verification email' }),
    ).not.toBeInTheDocument();
  });
});
