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
  items = [],
}: {
  profile?: unknown;
  profileStatus?: number;
  items?: unknown[];
}) {
  apiGetMock.mockImplementation((url: string) => {
    if (url === '/v1/me/photographer-profile') {
      return Promise.resolve({ data: profile, response: { status: profileStatus } });
    }
    if (url === '/v1/me/photographer-profile/portfolio') {
      return Promise.resolve({ data: { items, nextCursor: null }, response: { status: 200 } });
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

describe('DashboardPortfolioPage', () => {
  afterEach(() => {
    vi.resetModules();
    getSessionMock.mockReset();
    apiGetMock.mockReset();
  });

  it('redirects to sign-in when signed out', async () => {
    getSessionMock.mockResolvedValue(null);
    const Page = await loadPage();

    const digest = await redirectDigest(Page({ params: Promise.resolve({ locale: 'en' }) }));

    expect(digest).toContain(encodeURIComponent('/en/dashboard/portfolio'));
  });

  it('throws loudly on an unexpected profile lookup failure', async () => {
    getSessionMock.mockResolvedValue({ id: 'user-1' });
    apiGetMock.mockResolvedValue({ data: undefined, response: { status: 500 } });
    const Page = await loadPage();

    await expect(Page({ params: Promise.resolve({ locale: 'en' }) })).rejects.toThrow(/HTTP 500/);
  });

  it('shows a notice to create a profile first, without rendering the portfolio grid', async () => {
    getSessionMock.mockResolvedValue({ id: 'user-1' });
    mockApi({ profile: undefined, profileStatus: 404 });
    const Page = await loadPage();

    render(await Page({ params: Promise.resolve({ locale: 'en' }) }));

    expect(screen.getByText('Create your profile first')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Create your profile' })).toHaveAttribute(
      'href',
      '/en/dashboard/profile',
    );
    expect(screen.queryByRole('button', { name: 'Upload photos' })).not.toBeInTheDocument();
  });

  it('renders the portfolio grid once a profile exists', async () => {
    getSessionMock.mockResolvedValue({ id: 'user-1' });
    mockApi({
      profile: { id: 'profile-1' },
      items: [
        {
          id: 'image-1',
          url: 'https://cdn.example/image-1.jpg',
          width: 800,
          height: 600,
          order: 1,
          status: 'approved',
        },
      ],
    });
    const Page = await loadPage();

    render(await Page({ params: Promise.resolve({ locale: 'en' }) }));

    expect(screen.getByRole('button', { name: 'Upload photos' })).toBeInTheDocument();
    expect(screen.getByRole('img')).toBeInTheDocument();
  });
});
