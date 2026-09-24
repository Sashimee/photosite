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

const QUOTE = {
  id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  requestId: '3fa85f64-5717-4562-b3fc-2c963f66aaaa',
  photographerId: '3fa85f64-5717-4562-b3fc-2c963f66bbbb',
  photographer: {
    id: '3fa85f64-5717-4562-b3fc-2c963f66bbbb',
    slug: 'jane-doe',
    displayName: 'Jane Doe',
    avatarUrl: null,
    city: 'Luxembourg',
    countryCode: 'LU',
    ratingAvg: 4.5,
    ratingCount: 12,
  },
  clientId: '3fa85f64-5717-4562-b3fc-2c963f66cccc',
  productId: null,
  productTierId: null,
  lineItems: [{ label: 'Full day coverage', qty: 1, unitCents: 150000 }],
  subtotal: { amountCents: 150000, currency: 'EUR' },
  platformFee: { amountCents: 7500, currency: 'EUR' },
  total: { amountCents: 150000, currency: 'EUR' },
  validUntil: '2026-12-01T00:00:00.000Z',
  message: null,
  status: 'sent' as const,
};

const PUBLISHED_PROFILE = { id: 'profile-1', isPublished: true };

function mockApi({
  profile = PUBLISHED_PROFILE,
  profileStatus = 200,
  status = 200,
  items = [],
  nextCursor = null,
}: {
  profile?: unknown;
  profileStatus?: number;
  status?: number;
  items?: unknown[];
  nextCursor?: string | null;
}) {
  apiGetMock.mockImplementation((url: string) => {
    if (url === '/v1/me/photographer-profile') {
      return Promise.resolve({ data: profile, response: { status: profileStatus } });
    }
    if (url === '/v1/quotes/mine') {
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

describe('DashboardQuotesPage', () => {
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

    expect(digest).toContain(encodeURIComponent('/en/dashboard/quotes'));
  });

  it('throws loudly on an unexpected profile lookup failure', async () => {
    getSessionMock.mockResolvedValue({ id: 'photographer-user-1' });
    apiGetMock.mockResolvedValue({ data: undefined, response: { status: 500 } });
    const Page = await loadPage();

    await expect(
      Page({ params: Promise.resolve({ locale: 'en' }), searchParams: Promise.resolve({}) }),
    ).rejects.toThrow(/HTTP 500/);
  });

  it('shows a notice to create a profile first when there is none', async () => {
    getSessionMock.mockResolvedValue({ id: 'photographer-user-1' });
    mockApi({ profile: null, profileStatus: 404 });
    const Page = await loadPage();

    render(
      await Page({ params: Promise.resolve({ locale: 'en' }), searchParams: Promise.resolve({}) }),
    );

    expect(screen.getByText('Create your profile first')).toBeInTheDocument();
    expect(apiGetMock).not.toHaveBeenCalledWith('/v1/quotes/mine', expect.anything());
  });

  it('shows a notice that the profile must be published, without fetching quotes', async () => {
    getSessionMock.mockResolvedValue({ id: 'photographer-user-1' });
    mockApi({ profile: { id: 'profile-1', isPublished: false } });
    const Page = await loadPage();

    render(
      await Page({ params: Promise.resolve({ locale: 'en' }), searchParams: Promise.resolve({}) }),
    );

    expect(screen.getByText("Your profile isn't published yet")).toBeInTheDocument();
    expect(apiGetMock).not.toHaveBeenCalledWith('/v1/quotes/mine', expect.anything());
  });

  it('throws loudly on an unexpected feed failure', async () => {
    getSessionMock.mockResolvedValue({ id: 'photographer-user-1' });
    mockApi({ status: 500 });
    const Page = await loadPage();

    await expect(
      Page({ params: Promise.resolve({ locale: 'en' }), searchParams: Promise.resolve({}) }),
    ).rejects.toThrow(/HTTP 500/);
  });

  it('requests the photographer role explicitly', async () => {
    getSessionMock.mockResolvedValue({ id: 'photographer-user-1' });
    mockApi({ items: [] });
    const Page = await loadPage();

    await Page({ params: Promise.resolve({ locale: 'en' }), searchParams: Promise.resolve({}) });

    expect(apiGetMock).toHaveBeenCalledWith('/v1/quotes/mine', {
      params: { query: { role: 'photographer', limit: 20 } },
      cache: 'no-store',
    });
  });

  it('shows the empty state when nothing has been sent yet', async () => {
    getSessionMock.mockResolvedValue({ id: 'photographer-user-1' });
    mockApi({ items: [] });
    const Page = await loadPage();

    render(
      await Page({ params: Promise.resolve({ locale: 'en' }), searchParams: Promise.resolve({}) }),
    );

    expect(screen.getByText("You haven't sent any quotes yet.")).toBeInTheDocument();
  });

  it('shows the total, the payout net of the platform fee, and links to the quote', async () => {
    getSessionMock.mockResolvedValue({ id: 'photographer-user-1' });
    mockApi({ items: [QUOTE] });
    const Page = await loadPage();

    render(
      await Page({ params: Promise.resolve({ locale: 'en' }), searchParams: Promise.resolve({}) }),
    );

    expect(screen.getByText('€1,500.00')).toBeInTheDocument();
    expect(screen.getByText(/Your payout €1,425\.00/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /€1,500\.00/ })).toHaveAttribute(
      'href',
      `/en/quotes/${QUOTE.id}`,
    );
  });

  it('shows no payout for a declined, expired or withdrawn quote', async () => {
    getSessionMock.mockResolvedValue({ id: 'photographer-user-1' });
    mockApi({ items: [{ ...QUOTE, status: 'declined' }] });
    const Page = await loadPage();

    render(
      await Page({ params: Promise.resolve({ locale: 'en' }), searchParams: Promise.resolve({}) }),
    );

    expect(screen.queryByText(/Your payout/)).not.toBeInTheDocument();
  });

  it('links to the next page using the returned cursor', async () => {
    getSessionMock.mockResolvedValue({ id: 'photographer-user-1' });
    mockApi({ items: [QUOTE], nextCursor: 'cursor-abc' });
    const Page = await loadPage();

    render(
      await Page({ params: Promise.resolve({ locale: 'en' }), searchParams: Promise.resolve({}) }),
    );

    expect(screen.getByRole('link', { name: 'Next page' })).toHaveAttribute(
      'href',
      '/en/dashboard/quotes?cursor=cursor-abc',
    );
  });
});
