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
vi.mock('./search-filters', () => ({ SearchFiltersForm: () => null }));

function mockSearch(items: unknown[], nextCursor: string | null = null) {
  apiGetMock.mockResolvedValue({ data: { items, nextCursor }, response: { status: 200 } });
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

const PHOTOGRAPHER = {
  id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  slug: 'sofia-martins',
  displayName: 'Sofia Martins',
  headline: null,
  avatarUrl: null,
  categories: ['wedding'],
  languages: ['en'],
  city: 'Luxembourg City',
  countryCode: 'LU',
  ratingAvg: 0,
  ratingCount: 0,
  startingPrice: null,
};

describe('generateMetadata (search page)', () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it('is indexable with no filters and at least one result', async () => {
    vi.stubEnv('NEXT_PUBLIC_ALLOW_INDEXING', 'true');
    mockSearch([PHOTOGRAPHER]);
    const { generateMetadata } = await import('./page');

    const metadata = await generateMetadata({
      params: Promise.resolve({ locale: 'en' }),
      searchParams: Promise.resolve({}),
    });

    expect(metadata.robots).toBeUndefined();
    expect(metadata.alternates?.canonical).toBe('http://127.0.0.1:3000/en/photographers');
  });

  it('is noindex once any filter param is present', async () => {
    vi.stubEnv('NEXT_PUBLIC_ALLOW_INDEXING', 'true');
    mockSearch([PHOTOGRAPHER]);
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
});

describe('PhotographersSearchPage', () => {
  afterEach(() => {
    vi.resetModules();
    apiGetMock.mockReset();
  });

  it('shows the empty state with a clear-filters link when filtered results are empty', async () => {
    mockSearch([]);
    const { default: PhotographersSearchPage } = await import('./page');

    const element = await PhotographersSearchPage({
      params: Promise.resolve({ locale: 'en' }),
      searchParams: Promise.resolve({ city: 'Nowhere' }),
    });

    expect(collectText(element)).toContain('No photographers match your filters.');
    expect(collectHrefs(element)).toContain('/en/photographers');
  });

  it('renders a load-more link that preserves filters and carries the next cursor', async () => {
    mockSearch([PHOTOGRAPHER], 'next-page-cursor');
    const { default: PhotographersSearchPage } = await import('./page');

    const element = await PhotographersSearchPage({
      params: Promise.resolve({ locale: 'en' }),
      searchParams: Promise.resolve({ category: 'wedding' }),
    });

    expect(collectHrefs(element)).toContain(
      '/en/photographers?category=wedding&cursor=next-page-cursor',
    );
  });

  it('omits the load-more link once there is no next cursor', async () => {
    mockSearch([PHOTOGRAPHER], null);
    const { default: PhotographersSearchPage } = await import('./page');

    const element = await PhotographersSearchPage({
      params: Promise.resolve({ locale: 'en' }),
      searchParams: Promise.resolve({}),
    });

    expect(collectHrefs(element).some((href) => href.includes('cursor'))).toBe(false);
  });

  it('throws a plain error when the search API fails unexpectedly', async () => {
    apiGetMock.mockResolvedValue({ data: undefined, response: { status: 500 } });
    const { default: PhotographersSearchPage } = await import('./page');

    await expect(
      PhotographersSearchPage({
        params: Promise.resolve({ locale: 'en' }),
        searchParams: Promise.resolve({}),
      }),
    ).rejects.toThrow(/HTTP 500/);
  });
});
