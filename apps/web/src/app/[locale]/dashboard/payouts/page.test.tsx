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
vi.mock('./payouts-button', () => ({
  PayoutsButton: ({ resume }: { resume: boolean }) => (
    <button type="button">{resume ? 'resume' : 'start'}</button>
  ),
}));

const PROFILE = {
  id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  stripeOnboardingComplete: false,
  stripePayoutsEnabled: false,
};

function mockProfile(status: number, data?: unknown) {
  apiGetMock.mockImplementation((url: string) => {
    if (url === '/v1/me/photographer-profile') {
      return Promise.resolve({ data, response: { status } });
    }
    throw new Error(`unexpected GET ${url}`);
  });
}

async function loadMetadata() {
  const mod = await import('./page');
  return mod.generateMetadata;
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

describe('DashboardPayoutsPage', () => {
  afterEach(() => {
    vi.resetModules();
    getSessionMock.mockReset();
    apiGetMock.mockReset();
  });

  it('redirects to sign-in with the payouts path when signed out', async () => {
    getSessionMock.mockResolvedValue(null);
    const Page = await loadPage();

    const digest = await redirectDigest(Page({ params: Promise.resolve({ locale: 'en' }) }));

    expect(digest).toContain(encodeURIComponent('/en/dashboard/payouts'));
  });

  it('redirects to sign-in when the session expires between the check and the fetch', async () => {
    getSessionMock.mockResolvedValue({ id: 'user-1' });
    mockProfile(401);
    const Page = await loadPage();

    const digest = await redirectDigest(Page({ params: Promise.resolve({ locale: 'en' }) }));

    expect(digest).toContain(encodeURIComponent('/en/dashboard/payouts'));
  });

  it('throws loudly when the profile call fails', async () => {
    getSessionMock.mockResolvedValue({ id: 'user-1' });
    mockProfile(500);
    const Page = await loadPage();

    await expect(Page({ params: Promise.resolve({ locale: 'en' }) })).rejects.toThrow(/HTTP 500/);
  });

  it('asks for a profile first and offers no button without one', async () => {
    getSessionMock.mockResolvedValue({ id: 'user-1' });
    mockProfile(404);
    const Page = await loadPage();

    render(await Page({ params: Promise.resolve({ locale: 'en' }) }));

    expect(screen.getByText('Create your profile first')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('shows the not started state with the setup button', async () => {
    getSessionMock.mockResolvedValue({ id: 'user-1' });
    mockProfile(200, PROFILE);
    const Page = await loadPage();

    render(await Page({ params: Promise.resolve({ locale: 'en' }) }));

    expect(screen.getByText('Not started')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'start' })).toBeInTheDocument();
  });

  it('shows the review copy and the continue button when onboarding is incomplete', async () => {
    getSessionMock.mockResolvedValue({ id: 'user-1' });
    mockProfile(200, { ...PROFILE, stripeOnboardingComplete: true });
    const Page = await loadPage();

    render(await Page({ params: Promise.resolve({ locale: 'en' }) }));

    expect(screen.getByText('In review')).toBeInTheDocument();
    expect(screen.getByText(/Stripe is reviewing your details/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'resume' })).toBeInTheDocument();
  });

  it('shows payouts enabled without a button', async () => {
    getSessionMock.mockResolvedValue({ id: 'user-1' });
    mockProfile(200, { ...PROFILE, stripeOnboardingComplete: true, stripePayoutsEnabled: true });
    const Page = await loadPage();

    render(await Page({ params: Promise.resolve({ locale: 'en' }) }));

    expect(screen.getByText('Payouts enabled')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
  it('marks the page noindex with a translated title', async () => {
    const generateMetadata = await loadMetadata();

    const metadata = await generateMetadata({ params: Promise.resolve({ locale: 'en' }) });

    expect(metadata.robots).toEqual({ index: false, follow: false });
    expect(metadata.title).toBe(translate('web.dashboard.payouts', 'metaTitle'));
  });

  it('returns empty metadata for an unknown locale', async () => {
    const generateMetadata = await loadMetadata();

    expect(await generateMetadata({ params: Promise.resolve({ locale: 'xx' }) })).toEqual({});
  });

  it('renders not found for an unknown locale without calling the api', async () => {
    const Page = await loadPage();

    const digest = await redirectDigest(Page({ params: Promise.resolve({ locale: 'xx' }) }));

    expect(digest).toContain('NEXT_HTTP_ERROR_FALLBACK;404');
    expect(getSessionMock).not.toHaveBeenCalled();
    expect(apiGetMock).not.toHaveBeenCalled();
  });

  it('links the 404 state to the profile page', async () => {
    getSessionMock.mockResolvedValue({ id: 'user-1' });
    mockProfile(404);
    const Page = await loadPage();

    render(await Page({ params: Promise.resolve({ locale: 'en' }) }));

    expect(
      screen.getByRole('link', { name: translate('web.dashboard.payouts', 'needsProfileCta') }),
    ).toHaveAttribute('href', '/en/dashboard/profile');
  });
});
