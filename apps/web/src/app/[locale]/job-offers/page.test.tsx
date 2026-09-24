import { afterEach, describe, expect, it, vi } from 'vitest';

import { translate } from '@/testing/mock-translations';

const apiGetMock = vi.fn();

vi.mock('@/lib/api', () => ({ api: { GET: apiGetMock } }));
vi.mock('next-intl/server', () => ({
  getTranslations:
    ({ namespace }: { namespace: string }) =>
    (key: string, values?: Record<string, unknown>) =>
      translate(namespace, key, values),
}));
vi.mock('./job-offer-filters', () => ({ JobOfferFiltersForm: () => null }));

const COUNTRIES = [
  { code: 'LU', name: 'Luxembourg', currency: 'EUR', defaultLocale: 'fr' as const },
];

const OFFER = {
  id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  slug: 'wedding-photographer-needed',
  title: 'Wedding photographer needed',
  category: 'wedding',
  city: 'Luxembourg City',
  countryCode: 'LU',
  location: { lat: 49.61, lng: 6.13 },
  remote: false,
  compensation: null,
  publishedAt: '2026-08-01T09:00:00.000Z',
  company: {
    id: '4fa85f64-5717-4562-b3fc-2c963f66afa6',
    companyName: 'Acme Studios',
    website: 'https://acme.example',
    logoUrl: null,
    verified: true,
  },
};

function mockSearch(items: unknown[], nextCursor: string | null = null) {
  apiGetMock.mockImplementation((url: string) => {
    if (url === '/v1/countries') {
      return Promise.resolve({ data: COUNTRIES, response: { status: 200 } });
    }
    if (url === '/v1/job-offers') {
      return Promise.resolve({ data: { items, nextCursor }, response: { status: 200 } });
    }
    throw new Error(`unexpected GET ${url}`);
  });
}

interface ElementLike {
  props?: { href?: string; children?: unknown };
}

function collectHrefs(node: unknown, hrefs: string[] = []): string[] {
  const props = (node as ElementLike | null)?.props;
  if (!props) {
    return hrefs;
  }
  if (typeof props.href === 'string') {
    hrefs.push(props.href);
  }
  const children = props.children;
  if (Array.isArray(children)) {
    children.forEach((child) => collectHrefs(child, hrefs));
  } else if (children) {
    collectHrefs(children, hrefs);
  }
  return hrefs;
}

function collectText(node: unknown, texts: string[] = []): string[] {
  if (typeof node === 'string') {
    texts.push(node);
    return texts;
  }
  const props = (node as ElementLike | null)?.props;
  const children = props?.children;
  if (Array.isArray(children)) {
    children.forEach((child) => collectText(child, texts));
  } else if (children !== undefined) {
    collectText(children, texts);
  }
  return texts;
}

describe('generateMetadata (job board)', () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it('is indexable with no filters and at least one result', async () => {
    vi.stubEnv('NEXT_PUBLIC_ALLOW_INDEXING', 'true');
    mockSearch([OFFER]);
    const { generateMetadata } = await import('./page');

    const metadata = await generateMetadata({
      params: Promise.resolve({ locale: 'en' }),
      searchParams: Promise.resolve({}),
    });

    expect(metadata.robots).toBeUndefined();
    expect(metadata.alternates?.canonical).toBe('http://127.0.0.1:3000/en/job-offers');
  });

  it('is noindex once any filter param is present', async () => {
    vi.stubEnv('NEXT_PUBLIC_ALLOW_INDEXING', 'true');
    mockSearch([OFFER]);
    const { generateMetadata } = await import('./page');

    const metadata = await generateMetadata({
      params: Promise.resolve({ locale: 'en' }),
      searchParams: Promise.resolve({ category: 'wedding' }),
    });

    expect(metadata.robots).toEqual({ index: false, follow: false });
  });

  it('is noindex once the result set is empty, even with no filters', async () => {
    vi.stubEnv('NEXT_PUBLIC_ALLOW_INDEXING', 'true');
    mockSearch([]);
    const { generateMetadata } = await import('./page');

    const metadata = await generateMetadata({
      params: Promise.resolve({ locale: 'en' }),
      searchParams: Promise.resolve({}),
    });

    expect(metadata.robots).toEqual({ index: false, follow: false });
  });

  it('is noindex when indexing is disallowed even with no filters and results present', async () => {
    vi.stubEnv('NEXT_PUBLIC_ALLOW_INDEXING', 'false');
    mockSearch([OFFER]);
    const { generateMetadata } = await import('./page');

    const metadata = await generateMetadata({
      params: Promise.resolve({ locale: 'en' }),
      searchParams: Promise.resolve({}),
    });

    expect(metadata.robots).toEqual({ index: false, follow: false });
  });
});

describe('JobOffersBoardPage', () => {
  afterEach(() => {
    vi.resetModules();
    apiGetMock.mockReset();
  });

  it('shows the never-posted empty state with no filters', async () => {
    mockSearch([]);
    const { default: JobOffersBoardPage } = await import('./page');

    const element = await JobOffersBoardPage({
      params: Promise.resolve({ locale: 'en' }),
      searchParams: Promise.resolve({}),
    });

    expect(collectText(element)).toContain('No offers posted yet.');
    expect(collectText(element)).not.toContain('No offers match your filters.');
  });

  it('shows a distinct empty state, with a clear-filters link, when filtered results are empty', async () => {
    mockSearch([]);
    const { default: JobOffersBoardPage } = await import('./page');

    const element = await JobOffersBoardPage({
      params: Promise.resolve({ locale: 'en' }),
      searchParams: Promise.resolve({ city: 'Nowhere' }),
    });

    expect(collectText(element)).toContain('No offers match your filters.');
    expect(collectText(element)).not.toContain('No offers posted yet.');
    expect(collectHrefs(element)).toContain('/en/job-offers');
  });

  it('renders a load-more link that preserves filters and carries the next cursor', async () => {
    mockSearch([OFFER], 'next-page-cursor');
    const { default: JobOffersBoardPage } = await import('./page');

    const element = await JobOffersBoardPage({
      params: Promise.resolve({ locale: 'en' }),
      searchParams: Promise.resolve({ category: 'wedding' }),
    });

    expect(collectHrefs(element)).toContain(
      '/en/job-offers?category=wedding&cursor=next-page-cursor',
    );
  });

  it('omits the load-more link once there is no next cursor', async () => {
    mockSearch([OFFER], null);
    const { default: JobOffersBoardPage } = await import('./page');

    const element = await JobOffersBoardPage({
      params: Promise.resolve({ locale: 'en' }),
      searchParams: Promise.resolve({}),
    });

    expect(collectHrefs(element).some((href) => href.includes('cursor'))).toBe(false);
  });

  it('throws a plain error when the job offers search fails unexpectedly', async () => {
    apiGetMock.mockImplementation((url: string) => {
      if (url === '/v1/countries') {
        return Promise.resolve({ data: COUNTRIES, response: { status: 200 } });
      }
      return Promise.resolve({ data: undefined, response: { status: 500 } });
    });
    const { default: JobOffersBoardPage } = await import('./page');

    await expect(
      JobOffersBoardPage({
        params: Promise.resolve({ locale: 'en' }),
        searchParams: Promise.resolve({}),
      }),
    ).rejects.toThrow(/HTTP 500/);
  });

  it('throws a plain error when countries fail to load', async () => {
    apiGetMock.mockImplementation((url: string) => {
      if (url === '/v1/job-offers') {
        return Promise.resolve({
          data: { items: [], nextCursor: null },
          response: { status: 200 },
        });
      }
      return Promise.resolve({ data: undefined, response: { status: 500 } });
    });
    const { default: JobOffersBoardPage } = await import('./page');

    await expect(
      JobOffersBoardPage({
        params: Promise.resolve({ locale: 'en' }),
        searchParams: Promise.resolve({}),
      }),
    ).rejects.toThrow(/HTTP 500/);
  });
});
