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

const APPLICATION = {
  id: '3fa85f64-5717-4562-b3fc-2c963f66a222',
  jobOfferId: '3fa85f64-5717-4562-b3fc-2c963f66a111',
  photographerId: '3fa85f64-5717-4562-b3fc-2c963f66a333',
  message: 'I would love to shoot this wedding.',
  portfolioLink: 'https://example.com/portfolio',
  status: 'submitted',
  createdAt: '2026-01-05T00:00:00.000Z',
  jobOffer: {
    id: '3fa85f64-5717-4562-b3fc-2c963f66a111',
    slug: 'wedding-photographer-needed',
    title: 'Wedding photographer needed',
    status: 'published',
  },
};

function mockApi({
  status = 200,
  items = [],
  nextCursor = null,
}: {
  status?: number;
  items?: unknown[];
  nextCursor?: string | null;
}) {
  apiGetMock.mockImplementation((url: string) => {
    if (url === '/v1/me/job-applications') {
      return Promise.resolve({
        data: status === 200 ? { items, nextCursor } : undefined,
        response: { status },
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

function renderPage(cursor?: string) {
  const Page = loadPage();
  return Page.then((PageComponent) =>
    PageComponent({
      params: Promise.resolve({ locale: 'en' }),
      searchParams: Promise.resolve(cursor ? { cursor } : {}),
    }),
  );
}

describe('JobApplicationsPage', () => {
  afterEach(() => {
    vi.resetModules();
    getSessionMock.mockReset();
    apiGetMock.mockReset();
  });

  it('redirects to sign-in when signed out', async () => {
    getSessionMock.mockResolvedValue(null);

    const digest = await redirectDigest(renderPage());

    expect(digest).toContain(encodeURIComponent('/en/account/job-applications'));
  });

  it('throws loudly on an unexpected feed failure', async () => {
    getSessionMock.mockResolvedValue({ id: 'user-1' });
    mockApi({ status: 500 });

    await expect(renderPage()).rejects.toThrow(/HTTP 500/);
  });

  it('shows the distinct "haven\'t applied" empty state for zero applications', async () => {
    getSessionMock.mockResolvedValue({ id: 'user-1' });
    mockApi({ items: [] });

    render(await renderPage());

    expect(screen.getByText("You haven't applied to anything yet.")).toBeInTheDocument();
  });

  it('shows the same empty state for an account with no photographer role at all', async () => {
    getSessionMock.mockResolvedValue({ id: 'user-1' });
    mockApi({ status: 403 });

    render(await renderPage());

    expect(screen.getByText("You haven't applied to anything yet.")).toBeInTheDocument();
  });

  it('lists an application with status, offer link and withdraw action', async () => {
    getSessionMock.mockResolvedValue({ id: 'user-1' });
    mockApi({ items: [APPLICATION] });

    render(await renderPage());

    expect(screen.getByText('Submitted')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Wedding photographer needed' })).toHaveAttribute(
      'href',
      '/en/job-offers/wedding-photographer-needed',
    );
    expect(screen.getByRole('button', { name: 'Withdraw' })).toBeInTheDocument();
  });

  it('hides withdraw once the application is no longer submitted', async () => {
    getSessionMock.mockResolvedValue({ id: 'user-1' });
    mockApi({ items: [{ ...APPLICATION, status: 'shortlisted' }] });

    render(await renderPage());

    expect(screen.getByText('Shortlisted')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Withdraw' })).not.toBeInTheDocument();
  });

  it('links to the next page using the returned cursor', async () => {
    getSessionMock.mockResolvedValue({ id: 'user-1' });
    mockApi({ items: [APPLICATION], nextCursor: 'cursor-abc' });

    render(await renderPage());

    expect(screen.getByRole('link', { name: 'Load more' })).toHaveAttribute(
      'href',
      '/en/account/job-applications?cursor=cursor-abc',
    );
  });
});
