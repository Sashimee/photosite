import { afterEach, describe, expect, it, vi } from 'vitest';

import { translate } from '@/testing/mock-translations';

const apiGetMock = vi.fn();
const headersMock = vi.fn();
const getSessionMock = vi.fn();

vi.mock('@/lib/api', () => ({ api: { GET: apiGetMock } }));
vi.mock('@/lib/session', () => ({ getSession: getSessionMock }));
vi.mock('next/headers', () => ({ headers: headersMock }));
vi.mock('next-intl/server', () => ({
  getTranslations:
    ({ namespace }: { namespace: string }) =>
    (key: string, values?: Record<string, unknown>) =>
      translate(namespace, key, values),
}));
vi.mock('./apply-form', () => ({
  ApplyForm: () => null,
}));

const OFFER = {
  id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  slug: 'wedding-photographer-needed',
  title: 'Wedding photographer needed',
  description: 'Full day coverage for a wedding in Luxembourg City.',
  category: 'wedding',
  city: 'Luxembourg City',
  countryCode: 'LU',
  location: { lat: 49.61, lng: 6.13 },
  remote: false,
  compensation: null,
  publishedAt: '2026-08-01T09:00:00.000Z',
  startDate: null,
  endDate: null,
  expiresAt: '2026-10-31T09:00:00.000Z',
  company: {
    id: '4fa85f64-5717-4562-b3fc-2c963f66afa6',
    companyName: 'Acme Studios',
    website: 'https://acme.example',
    logoUrl: null,
    verified: true,
  },
};

async function loadPage() {
  const mod = await import('./page');
  return mod.default;
}

function mockHeaders(overrides: Record<string, string> = {}) {
  headersMock.mockResolvedValue(new Headers(overrides));
}

function mockOffer(opts: { status: number; data?: unknown }) {
  apiGetMock.mockResolvedValue({ data: opts.data, response: { status: opts.status } });
}

describe('JobOfferDetailPage', () => {
  afterEach(() => {
    vi.resetModules();
    apiGetMock.mockReset();
    headersMock.mockReset();
    getSessionMock.mockReset();
  });

  it('renders notFound for an expired, closed, deleted or unknown slug alike (a 404)', async () => {
    mockOffer({ status: 404 });
    mockHeaders();
    getSessionMock.mockResolvedValue(null);
    const JobOfferDetailPage = await loadPage();

    const error: unknown = await JobOfferDetailPage({
      params: Promise.resolve({ locale: 'en', slug: 'gone' }),
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect((error as { digest?: string }).digest).toMatch(/;404$/);
  });

  it('throws a plain error when the API fails unexpectedly', async () => {
    mockOffer({ status: 500 });
    mockHeaders();
    getSessionMock.mockResolvedValue(null);
    const JobOfferDetailPage = await loadPage();

    await expect(
      JobOfferDetailPage({
        params: Promise.resolve({ locale: 'en', slug: 'wedding-photographer-needed' }),
      }),
    ).rejects.toThrow(/HTTP 500/);
  });

  it('embeds the JobPosting JSON-LD script with the request nonce', async () => {
    mockOffer({ status: 200, data: OFFER });
    mockHeaders({ 'x-nonce': 'abc123' });
    getSessionMock.mockResolvedValue(null);
    const JobOfferDetailPage = await loadPage();

    const element = await JobOfferDetailPage({
      params: Promise.resolve({ locale: 'en', slug: 'wedding-photographer-needed' }),
    });
    const children = (
      element.props as {
        children: {
          type: string;
          props: { nonce?: string; dangerouslySetInnerHTML: { __html: string } };
        }[];
      }
    ).children;
    const script = children.find((child) => child.type === 'script');

    expect(script?.props.nonce).toBe('abc123');
    expect(script?.props.dangerouslySetInnerHTML.__html).toContain('JobPosting');
    expect(script?.props.dangerouslySetInnerHTML.__html).not.toContain('geo');
  });

  it('passes a sign-in href to the apply form when signed out', async () => {
    mockOffer({ status: 200, data: OFFER });
    mockHeaders();
    getSessionMock.mockResolvedValue(null);
    const JobOfferDetailPage = await loadPage();
    const { ApplyForm } = await import('./apply-form');

    const element = await JobOfferDetailPage({
      params: Promise.resolve({ locale: 'en', slug: 'wedding-photographer-needed' }),
    });
    const applyForm = findByType(element, ApplyForm) as {
      props: { signInHref?: string; applicationsHref: string };
    };

    expect(applyForm.props.signInHref).toBe(
      '/en/sign-in?next=%2Fen%2Fjob-offers%2Fwedding-photographer-needed',
    );
    expect(applyForm.props.applicationsHref).toBe('/en/account/job-applications');
  });

  it('renders the shared email-verification prompt instead of the apply form for an unverified signed-in user', async () => {
    mockOffer({ status: 200, data: OFFER });
    mockHeaders();
    getSessionMock.mockResolvedValue({ email: 'jane@example.com', emailVerifiedAt: null });
    const JobOfferDetailPage = await loadPage();
    const { ApplyForm } = await import('./apply-form');

    const element = await JobOfferDetailPage({
      params: Promise.resolve({ locale: 'en', slug: 'wedding-photographer-needed' }),
    });

    expect(findByType(element, ApplyForm)).toBeUndefined();
  });

  it('renders the apply form with no sign-in href for a verified signed-in user', async () => {
    mockOffer({ status: 200, data: OFFER });
    mockHeaders();
    getSessionMock.mockResolvedValue({
      email: 'jane@example.com',
      emailVerifiedAt: '2026-01-01T00:00:00.000Z',
    });
    const JobOfferDetailPage = await loadPage();
    const { ApplyForm } = await import('./apply-form');

    const element = await JobOfferDetailPage({
      params: Promise.resolve({ locale: 'en', slug: 'wedding-photographer-needed' }),
    });
    const applyForm = findByType(element, ApplyForm) as { props: { signInHref?: string } };

    expect(applyForm.props.signInHref).toBeUndefined();
  });
});

describe('generateMetadata', () => {
  afterEach(() => {
    vi.resetModules();
    apiGetMock.mockReset();
  });

  it('returns empty metadata for an unknown slug instead of throwing', async () => {
    mockOffer({ status: 404 });
    const { generateMetadata } = await import('./page');

    const metadata = await generateMetadata({
      params: Promise.resolve({ locale: 'en', slug: 'gone' }),
    });

    expect(metadata).toEqual({});
  });

  it('returns canonical, hreflang and a title combining the offer and company', async () => {
    mockOffer({ status: 200, data: OFFER });
    const { generateMetadata } = await import('./page');

    const metadata = await generateMetadata({
      params: Promise.resolve({ locale: 'en', slug: 'wedding-photographer-needed' }),
    });

    expect(metadata.title).toBe('Wedding photographer needed at Acme Studios');
    expect(metadata.alternates?.canonical).toBe(
      'http://127.0.0.1:3000/en/job-offers/wedding-photographer-needed',
    );
    expect(metadata.alternates?.languages).toMatchObject({
      'x-default': 'http://127.0.0.1:3000/en/job-offers/wedding-photographer-needed',
    });
  });
});

interface ElementLike {
  type?: unknown;
  props?: { children?: unknown };
}

function findByType(node: unknown, type: unknown): ElementLike | undefined {
  const element = node as ElementLike | null;
  if (!element || typeof element !== 'object') {
    return undefined;
  }
  if (element.type === type) {
    return element;
  }
  const children = element.props?.children;
  if (Array.isArray(children)) {
    for (const child of children) {
      const found = findByType(child, type);
      if (found) {
        return found;
      }
    }
    return undefined;
  }
  return findByType(children, type);
}
