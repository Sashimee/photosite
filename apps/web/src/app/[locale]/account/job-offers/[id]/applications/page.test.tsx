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

const JOB_OFFER = {
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
  status: 'published',
  publishedAt: '2026-01-01T00:00:00.000Z',
  expiresAt: '2026-03-01T00:00:00.000Z',
};

const APPLICATION = {
  id: '3fa85f64-5717-4562-b3fc-2c963f66a222',
  jobOfferId: JOB_OFFER.id,
  photographerId: '3fa85f64-5717-4562-b3fc-2c963f66a333',
  message: 'I would love to shoot this wedding.',
  portfolioLink: 'https://example.com/portfolio',
  status: 'submitted',
  createdAt: '2026-01-05T00:00:00.000Z',
  photographer: {
    id: '3fa85f64-5717-4562-b3fc-2c963f66a333',
    slug: 'jane-doe-photography',
    displayName: 'Jane Doe',
    avatarUrl: null,
    city: 'Luxembourg',
    countryCode: 'LU',
  },
};

function mockApi({
  jobOffer,
  jobOfferStatus = 200,
  applications = [],
  applicationsStatus = 200,
  nextCursor = null,
}: {
  jobOffer?: unknown;
  jobOfferStatus?: number;
  applications?: unknown[];
  applicationsStatus?: number;
  nextCursor?: string | null;
}) {
  apiGetMock.mockImplementation((url: string) => {
    if (url === '/v1/me/job-offers/{id}') {
      return Promise.resolve({
        data: jobOfferStatus === 200 ? jobOffer : undefined,
        response: { status: jobOfferStatus },
      });
    }
    if (url === '/v1/job-offers/{id}/applications') {
      return Promise.resolve({
        data: applicationsStatus === 200 ? { items: applications, nextCursor } : undefined,
        response: { status: applicationsStatus },
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
      params: Promise.resolve({ locale: 'en', id: JOB_OFFER.id }),
      searchParams: Promise.resolve(cursor ? { cursor } : {}),
    }),
  );
}

describe('JobOfferApplicationsPage', () => {
  afterEach(() => {
    vi.resetModules();
    getSessionMock.mockReset();
    apiGetMock.mockReset();
  });

  it('redirects to sign-in when signed out', async () => {
    getSessionMock.mockResolvedValue(null);

    const digest = await redirectDigest(renderPage());

    expect(digest).toContain(
      encodeURIComponent(`/en/account/job-offers/${JOB_OFFER.id}/applications`),
    );
  });

  it("renders not-found for an offer that is not this professional's or never existed", async () => {
    getSessionMock.mockResolvedValue({ id: 'user-1' });
    mockApi({ jobOfferStatus: 404 });

    const digest = await redirectDigest(renderPage());

    expect(digest).toMatch(/;404$/);
  });

  it('renders not-found for a caller with no professional role at all', async () => {
    getSessionMock.mockResolvedValue({ id: 'user-1' });
    mockApi({ jobOfferStatus: 403 });

    const digest = await redirectDigest(renderPage());

    expect(digest).toMatch(/;404$/);
  });

  it('throws loudly on an unexpected job offer lookup failure', async () => {
    getSessionMock.mockResolvedValue({ id: 'user-1' });
    apiGetMock.mockResolvedValue({ data: undefined, response: { status: 500 } });

    await expect(renderPage()).rejects.toThrow(/HTTP 500/);
  });

  it('throws loudly on an unexpected applications feed failure', async () => {
    getSessionMock.mockResolvedValue({ id: 'user-1' });
    mockApi({ jobOffer: JOB_OFFER, applicationsStatus: 500 });

    await expect(renderPage()).rejects.toThrow(/HTTP 500/);
  });

  it('shows a distinct empty state for an offer with no applications yet', async () => {
    getSessionMock.mockResolvedValue({ id: 'user-1' });
    mockApi({ jobOffer: JOB_OFFER, applications: [] });

    render(await renderPage());

    expect(screen.getByText('No applications yet.')).toBeInTheDocument();
  });

  it('lists an application with the photographer link, message, portfolio link and actions', async () => {
    getSessionMock.mockResolvedValue({ id: 'user-1' });
    mockApi({ jobOffer: JOB_OFFER, applications: [APPLICATION] });

    render(await renderPage());

    expect(screen.getByText('Applications for "Wedding photographer needed"')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Jane Doe/ })).toHaveAttribute(
      'href',
      '/en/photographers/jane-doe-photography',
    );
    expect(screen.getByText(APPLICATION.message)).toBeInTheDocument();
    const portfolioLink = screen.getByRole('link', { name: 'Portfolio link' });
    expect(portfolioLink).toHaveAttribute('href', APPLICATION.portfolioLink);
    expect(portfolioLink).toHaveAttribute('rel', 'nofollow noopener');
    expect(screen.getByRole('button', { name: 'Shortlist' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reject' })).toBeInTheDocument();
  });

  it('hides shortlist and reject once the application is no longer submitted', async () => {
    getSessionMock.mockResolvedValue({ id: 'user-1' });
    mockApi({ jobOffer: JOB_OFFER, applications: [{ ...APPLICATION, status: 'shortlisted' }] });

    render(await renderPage());

    expect(screen.queryByRole('button', { name: 'Shortlist' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reject' })).not.toBeInTheDocument();
    expect(screen.getByText('Shortlisted')).toBeInTheDocument();
  });

  it('does not render a portfolio link when none was submitted', async () => {
    getSessionMock.mockResolvedValue({ id: 'user-1' });
    mockApi({ jobOffer: JOB_OFFER, applications: [{ ...APPLICATION, portfolioLink: null }] });

    render(await renderPage());

    expect(screen.queryByRole('link', { name: 'Portfolio link' })).not.toBeInTheDocument();
  });

  it('links to the next page using the returned cursor', async () => {
    getSessionMock.mockResolvedValue({ id: 'user-1' });
    mockApi({ jobOffer: JOB_OFFER, applications: [APPLICATION], nextCursor: 'cursor-abc' });

    render(await renderPage());

    expect(screen.getByRole('link', { name: 'Load more' })).toHaveAttribute(
      'href',
      `/en/account/job-offers/${JOB_OFFER.id}/applications?cursor=cursor-abc`,
    );
  });
});
