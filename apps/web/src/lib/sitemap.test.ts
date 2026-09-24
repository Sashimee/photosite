import { SUPPORTED_LOCALES } from '@photoo/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { isCountrySegment } from './discovery';

const apiGetMock = vi.fn();
const loadEnabledCountryCodesMock = vi.fn();
const resolveCountryLandingMock = vi.fn();
const resolveCityLandingMock = vi.fn();
const resolveCategoryLandingMock = vi.fn();

vi.mock('@/lib/api', () => ({ api: { GET: apiGetMock } }));
vi.mock('@/app/[locale]/photographers/[slug]/landing-data', () => ({
  loadEnabledCountryCodes: loadEnabledCountryCodesMock,
  resolveCountryLanding: resolveCountryLandingMock,
  resolveCityLanding: resolveCityLandingMock,
  resolveCategoryLanding: resolveCategoryLandingMock,
}));

const PHOTOGRAPHER = {
  id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  slug: 'sofia-martins',
  displayName: 'Sofia Martins',
};

function items(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    ...PHOTOGRAPHER,
    slug: `slug-${String(index)}`,
  }));
}

describe('buildSitemapPaths', () => {
  afterEach(() => {
    vi.resetModules();
    apiGetMock.mockReset();
    loadEnabledCountryCodesMock.mockReset();
    resolveCountryLandingMock.mockReset();
    resolveCityLandingMock.mockReset();
    resolveCategoryLandingMock.mockReset();
  });

  it('always includes the home path, and includes the photographers/job-offers boards only when non-empty', async () => {
    apiGetMock.mockImplementation(
      (url: string, options: { params: { query: Record<string, unknown> } }) => {
        if (url === '/v1/photographers' && options.params.query.limit === 1) {
          return Promise.resolve({
            data: { items: [], nextCursor: null },
            response: { status: 200 },
          });
        }
        if (url === '/v1/job-offers') {
          return Promise.resolve({
            data: { items: [PHOTOGRAPHER], nextCursor: null },
            response: { status: 200 },
          });
        }
        if (url === '/v1/photographers') {
          return Promise.resolve({
            data: { items: [], nextCursor: null },
            response: { status: 200 },
          });
        }
        throw new Error(`unexpected GET ${url}`);
      },
    );
    loadEnabledCountryCodesMock.mockResolvedValue([]);

    const { buildSitemapPaths } = await import('./sitemap');
    const paths = await buildSitemapPaths();

    expect(paths).toContain('/');
    expect(paths).toContain('/job-offers');
    expect(paths).not.toContain('/photographers');
  });

  it('paginates every published photographer profile', async () => {
    apiGetMock.mockImplementation(
      (url: string, options: { params: { query: Record<string, unknown> } }) => {
        if (url === '/v1/job-offers') {
          return Promise.resolve({
            data: { items: [], nextCursor: null },
            response: { status: 200 },
          });
        }
        if (url === '/v1/photographers') {
          if (options.params.query.limit === 1) {
            return Promise.resolve({
              data: { items: [PHOTOGRAPHER], nextCursor: null },
              response: { status: 200 },
            });
          }
          if (!options.params.query.cursor) {
            return Promise.resolve({
              data: { items: items(2), nextCursor: 'page-2' },
              response: { status: 200 },
            });
          }
          return Promise.resolve({
            data: { items: [{ ...PHOTOGRAPHER, slug: 'slug-2' }], nextCursor: null },
            response: { status: 200 },
          });
        }
        throw new Error(`unexpected GET ${url}`);
      },
    );
    loadEnabledCountryCodesMock.mockResolvedValue([]);

    const { buildSitemapPaths } = await import('./sitemap');
    const paths = await buildSitemapPaths();

    expect(paths).toContain('/photographers/slug-0');
    expect(paths).toContain('/photographers/slug-1');
    expect(paths).toContain('/photographers/slug-2');
  });

  // A 2-letter profile slug would be routed as a country landing page
  // instead (`isCountrySegment`, `lib/discovery.ts`), so a sitemap that ever
  // emitted one would point crawlers at the wrong page. `SlugSchema.min(3)`
  // already makes this impossible at the API, but the sitemap asserts it
  // independently rather than trusting that invariant to hold forever.
  it('never emits a profile path whose slug could be mistaken for a country segment', async () => {
    apiGetMock.mockImplementation(
      (url: string, options: { params: { query: Record<string, unknown> } }) => {
        if (url === '/v1/job-offers') {
          return Promise.resolve({
            data: { items: [], nextCursor: null },
            response: { status: 200 },
          });
        }
        if (url === '/v1/photographers') {
          if (options.params.query.limit === 1) {
            return Promise.resolve({
              data: { items: items(1), nextCursor: null },
              response: { status: 200 },
            });
          }
          return Promise.resolve({
            data: { items: items(5), nextCursor: null },
            response: { status: 200 },
          });
        }
        throw new Error(`unexpected GET ${url}`);
      },
    );
    loadEnabledCountryCodesMock.mockResolvedValue([]);

    const { buildSitemapPaths } = await import('./sitemap');
    const paths = await buildSitemapPaths();

    const profileSlugs = paths
      .filter((path) => path.startsWith('/photographers/') && path.split('/').length === 3)
      .map((path) => {
        const slug = path.split('/')[2];
        if (!slug) {
          throw new Error(`unexpected profile path shape: ${path}`);
        }
        return slug;
      });

    expect(profileSlugs.length).toBeGreaterThan(0);
    for (const slug of profileSlugs) {
      expect(isCountrySegment(slug)).toBe(false);
    }
  });

  it('includes country, city and category landing pages only when each has results, skipping thin ones', async () => {
    apiGetMock.mockImplementation((url: string) => {
      if (url === '/v1/job-offers') {
        return Promise.resolve({
          data: { items: [], nextCursor: null },
          response: { status: 200 },
        });
      }
      if (url === '/v1/photographers') {
        return Promise.resolve({
          data: { items: [], nextCursor: null },
          response: { status: 200 },
        });
      }
      throw new Error(`unexpected GET ${url}`);
    });
    loadEnabledCountryCodesMock.mockResolvedValue(['LU']);

    const nonEmptyCity = { slug: 'luxembourg-city', name: 'Luxembourg City', countryCode: 'LU' };
    const thinCity = { slug: 'ettelbruck', name: 'Ettelbruck', countryCode: 'LU' };

    resolveCountryLandingMock.mockResolvedValue({
      cities: [nonEmptyCity, thinCity],
      photographers: { items: [PHOTOGRAPHER] },
    });
    resolveCityLandingMock.mockImplementation((_country: string, citySlug: string) => {
      if (citySlug === 'luxembourg-city') {
        return Promise.resolve({
          city: nonEmptyCity,
          cities: [nonEmptyCity, thinCity],
          photographers: { items: [PHOTOGRAPHER] },
        });
      }
      return Promise.resolve({
        city: thinCity,
        cities: [nonEmptyCity, thinCity],
        photographers: { items: [] },
      });
    });
    resolveCategoryLandingMock.mockImplementation(
      (_country: string, _citySlug: string, category: string) => {
        if (category === 'wedding') {
          return Promise.resolve({
            city: nonEmptyCity,
            cities: [nonEmptyCity],
            photographers: { items: [PHOTOGRAPHER] },
            category,
          });
        }
        return Promise.resolve({
          city: nonEmptyCity,
          cities: [nonEmptyCity],
          photographers: { items: [] },
          category,
        });
      },
    );

    const { buildSitemapPaths } = await import('./sitemap');
    const paths = await buildSitemapPaths();

    expect(paths).toContain('/photographers/lu');
    expect(paths).toContain('/photographers/lu/luxembourg-city');
    expect(paths).toContain('/photographers/lu/luxembourg-city/wedding');
    expect(paths).not.toContain('/photographers/lu/ettelbruck');
    expect(paths).not.toContain('/photographers/lu/luxembourg-city/portrait');
  });

  it('excludes a country landing entirely when the country-wide search is empty', async () => {
    apiGetMock.mockImplementation((url: string) => {
      if (url === '/v1/job-offers' || url === '/v1/photographers') {
        return Promise.resolve({
          data: { items: [], nextCursor: null },
          response: { status: 200 },
        });
      }
      throw new Error(`unexpected GET ${url}`);
    });
    loadEnabledCountryCodesMock.mockResolvedValue(['LU']);
    resolveCountryLandingMock.mockResolvedValue({ cities: [], photographers: { items: [] } });

    const { buildSitemapPaths } = await import('./sitemap');
    const paths = await buildSitemapPaths();

    expect(paths.some((path) => path.startsWith('/photographers/lu'))).toBe(false);
    expect(resolveCityLandingMock).not.toHaveBeenCalled();
  });

  it('fails loudly rather than emitting a profile path indistinguishable from a country segment', async () => {
    apiGetMock.mockImplementation(
      (url: string, options: { params: { query: Record<string, unknown> } }) => {
        if (url === '/v1/job-offers') {
          return Promise.resolve({
            data: { items: [], nextCursor: null },
            response: { status: 200 },
          });
        }
        if (url === '/v1/photographers') {
          if (options.params.query.limit === 1) {
            return Promise.resolve({
              data: { items: items(1), nextCursor: null },
              response: { status: 200 },
            });
          }
          return Promise.resolve({
            data: { items: [{ ...PHOTOGRAPHER, slug: 'lu' }], nextCursor: null },
            response: { status: 200 },
          });
        }
        throw new Error(`unexpected GET ${url}`);
      },
    );
    loadEnabledCountryCodesMock.mockResolvedValue([]);

    const { buildSitemapPaths } = await import('./sitemap');
    await expect(buildSitemapPaths()).rejects.toThrow(/indistinguishable from a country segment/);
  });

  it('fails loudly instead of returning a truncated sitemap when a source errors', async () => {
    apiGetMock.mockImplementation((url: string) => {
      if (url === '/v1/job-offers') {
        return Promise.resolve({
          data: { items: [], nextCursor: null },
          response: { status: 200 },
        });
      }
      return Promise.resolve({ data: undefined, response: { status: 500 } });
    });
    loadEnabledCountryCodesMock.mockResolvedValue([]);

    const { buildSitemapPaths } = await import('./sitemap');
    await expect(buildSitemapPaths()).rejects.toThrow(/HTTP 500/);
  });
});

describe('buildSitemap', () => {
  afterEach(() => {
    vi.resetModules();
    apiGetMock.mockReset();
    loadEnabledCountryCodesMock.mockReset();
  });

  it('emits one entry per locale per path, each with a full reciprocal hreflang set', async () => {
    apiGetMock.mockImplementation((url: string) => {
      if (url === '/v1/job-offers' || url === '/v1/photographers') {
        return Promise.resolve({
          data: { items: [], nextCursor: null },
          response: { status: 200 },
        });
      }
      throw new Error(`unexpected GET ${url}`);
    });
    loadEnabledCountryCodesMock.mockResolvedValue([]);

    const { buildSitemap } = await import('./sitemap');
    const entries = await buildSitemap();

    expect(entries).toHaveLength(SUPPORTED_LOCALES.length);
    const home = entries.find((entry) => entry.url === 'http://127.0.0.1:3000/en');
    expect(home?.alternates?.languages).toMatchObject({
      en: 'http://127.0.0.1:3000/en',
      fr: 'http://127.0.0.1:3000/fr',
      'x-default': 'http://127.0.0.1:3000/en',
    });
  });
});
