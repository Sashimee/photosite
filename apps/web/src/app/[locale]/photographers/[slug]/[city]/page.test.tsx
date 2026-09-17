import { afterEach, describe, expect, it, vi } from 'vitest';

import { translate } from '@/testing/mock-translations';

const resolveCityLandingMock = vi.fn();
const headersMock = vi.fn();

vi.mock('../landing-data', () => ({ resolveCityLanding: resolveCityLandingMock }));
vi.mock('next/headers', () => ({ headers: headersMock }));
vi.mock('next-intl/server', () => ({
  getTranslations:
    ({ namespace }: { namespace: string }) =>
    (key: string, values?: Record<string, unknown>) =>
      translate(namespace, key, values),
}));

function mockHeaders(overrides: Record<string, string> = {}) {
  headersMock.mockResolvedValue(new Headers(overrides));
}

const CITY = {
  slug: 'luxembourg-city',
  name: 'Luxembourg City',
  countryCode: 'LU',
  photographerCount: 1,
};

describe('generateMetadata (city landing)', () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    resolveCityLandingMock.mockReset();
  });

  it('returns empty metadata for an unknown city slug', async () => {
    resolveCityLandingMock.mockResolvedValue(null);
    const { generateMetadata } = await import('./page');

    const metadata = await generateMetadata({
      params: Promise.resolve({ locale: 'en', slug: 'lu', city: 'unknown-city' }),
    });

    expect(metadata).toEqual({});
  });

  it('is noindex when the city has zero results', async () => {
    vi.stubEnv('NEXT_PUBLIC_ALLOW_INDEXING', 'true');
    resolveCityLandingMock.mockResolvedValue({
      city: CITY,
      cities: [CITY],
      photographers: { items: [], nextCursor: null },
    });
    const { generateMetadata } = await import('./page');

    const metadata = await generateMetadata({
      params: Promise.resolve({ locale: 'en', slug: 'lu', city: 'luxembourg-city' }),
    });

    expect(metadata.robots).toEqual({ index: false, follow: false });
    expect(metadata.alternates?.canonical).toBe(
      'http://127.0.0.1:3000/en/photographers/lu/luxembourg-city',
    );
  });
});

describe('CityLandingPage', () => {
  afterEach(() => {
    vi.resetModules();
    resolveCityLandingMock.mockReset();
    headersMock.mockReset();
  });

  it('404s for an unknown city slug', async () => {
    resolveCityLandingMock.mockResolvedValue(null);
    mockHeaders();
    const { default: CityLandingPage } = await import('./page');

    const error: unknown = await CityLandingPage({
      params: Promise.resolve({ locale: 'en', slug: 'lu', city: 'unknown-city' }),
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect((error as { digest?: string }).digest).toMatch(/;404$/);
  });

  it('404s for a disabled country even with a plausible city slug', async () => {
    resolveCityLandingMock.mockResolvedValue(null);
    mockHeaders();
    const { default: CityLandingPage } = await import('./page');

    const error: unknown = await CityLandingPage({
      params: Promise.resolve({ locale: 'en', slug: 'fr', city: 'paris' }),
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect((error as { digest?: string }).digest).toMatch(/;404$/);
  });
});
