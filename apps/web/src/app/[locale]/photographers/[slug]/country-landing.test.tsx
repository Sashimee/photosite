import { afterEach, describe, expect, it, vi } from 'vitest';

import { translate } from '@/testing/mock-translations';

const resolveCountryLandingMock = vi.fn();
const headersMock = vi.fn();

vi.mock('./landing-data', () => ({ resolveCountryLanding: resolveCountryLandingMock }));
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

describe('generateCountryLandingMetadata', () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    resolveCountryLandingMock.mockReset();
  });

  it('returns empty metadata for a disabled or unknown country', async () => {
    resolveCountryLandingMock.mockResolvedValue(null);
    const { generateCountryLandingMetadata } = await import('./country-landing');

    const metadata = await generateCountryLandingMetadata({ locale: 'en', countryCode: 'FR' });

    expect(metadata).toEqual({});
  });

  it('is indexable when the country has results', async () => {
    vi.stubEnv('NEXT_PUBLIC_ALLOW_INDEXING', 'true');
    resolveCountryLandingMock.mockResolvedValue({
      cities: [],
      photographers: { items: [PHOTOGRAPHER], nextCursor: null },
    });
    const { generateCountryLandingMetadata } = await import('./country-landing');

    const metadata = await generateCountryLandingMetadata({ locale: 'en', countryCode: 'LU' });

    expect(metadata.robots).toBeUndefined();
    expect(metadata.alternates?.canonical).toBe('http://127.0.0.1:3000/en/photographers/lu');
    expect(metadata.alternates?.languages).toMatchObject({
      en: 'http://127.0.0.1:3000/en/photographers/lu',
      'x-default': 'http://127.0.0.1:3000/en/photographers/lu',
    });
  });

  it('is noindex when the country has zero results', async () => {
    vi.stubEnv('NEXT_PUBLIC_ALLOW_INDEXING', 'true');
    resolveCountryLandingMock.mockResolvedValue({
      cities: [],
      photographers: { items: [], nextCursor: null },
    });
    const { generateCountryLandingMetadata } = await import('./country-landing');

    const metadata = await generateCountryLandingMetadata({ locale: 'en', countryCode: 'LU' });

    expect(metadata.robots).toEqual({ index: false, follow: false });
  });
});

describe('CountryLandingPage', () => {
  afterEach(() => {
    vi.resetModules();
    resolveCountryLandingMock.mockReset();
    headersMock.mockReset();
  });

  it('404s for a disabled or unknown country', async () => {
    resolveCountryLandingMock.mockResolvedValue(null);
    mockHeaders();
    const { CountryLandingPage } = await import('./country-landing');

    const error: unknown = await CountryLandingPage({ locale: 'en', countryCode: 'FR' }).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(Error);
    expect((error as { digest?: string }).digest).toMatch(/;404$/);
  });

  it('embeds escaped ItemList JSON-LD with the request nonce', async () => {
    resolveCountryLandingMock.mockResolvedValue({
      cities: [
        {
          slug: 'luxembourg-city',
          name: 'Luxembourg City',
          countryCode: 'LU',
          photographerCount: 1,
        },
      ],
      photographers: { items: [PHOTOGRAPHER], nextCursor: null },
    });
    mockHeaders({ 'x-nonce': 'abc123' });
    const { CountryLandingPage } = await import('./country-landing');

    const element = await CountryLandingPage({ locale: 'en', countryCode: 'LU' });
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
    expect(script?.props.dangerouslySetInnerHTML.__html).toContain(
      'http://127.0.0.1:3000/en/photographers/sofia-martins',
    );
  });
});
