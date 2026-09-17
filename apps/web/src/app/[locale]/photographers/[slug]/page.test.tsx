import { afterEach, describe, expect, it, vi } from 'vitest';

import { translate } from '@/testing/mock-translations';

const apiGetMock = vi.fn();
const headersMock = vi.fn();
const countryLandingMetadataMock = vi.fn();

vi.mock('@/lib/api', () => ({ api: { GET: apiGetMock } }));
vi.mock('next/headers', () => ({ headers: headersMock }));
vi.mock('next-intl/server', () => ({
  getTranslations:
    ({ namespace }: { namespace: string }) =>
    (key: string, values?: Record<string, unknown>) =>
      translate(namespace, key, values),
}));
vi.mock('./country-landing', () => ({
  CountryLandingPage: (props: { locale: string; countryCode: string }) => ({
    type: 'country-landing-stub',
    props,
  }),
  generateCountryLandingMetadata: countryLandingMetadataMock,
}));

const PROFILE = {
  id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  slug: 'sofia-martins',
  displayName: 'Sofia Martins',
  headline: 'Wedding and portrait photographer',
  bio: { en: 'Documentary-style wedding photography.' },
  avatarUrl: null,
  coverUrl: null,
  links: { instagram: null, website: null, behance: null, other: [] },
  categories: ['wedding'],
  languages: ['en'],
  serviceRadiusKm: 30,
  city: 'Luxembourg City',
  countryCode: 'LU',
  ratingAvg: 4.8,
  ratingCount: 12,
  portfolio: [],
};

async function loadPage() {
  const mod = await import('./page');
  return mod.default;
}

function mockHeaders(overrides: Record<string, string> = {}) {
  headersMock.mockResolvedValue(new Headers(overrides));
}

function mockApi(opts: {
  profile: { status: number; data?: unknown };
  products?: { status: number; data?: unknown };
}) {
  const products = opts.products ?? {
    status: opts.profile.status,
    data: opts.profile.data ? [] : undefined,
  };
  apiGetMock.mockImplementation((url: string) => {
    if (url.includes('/products')) {
      return Promise.resolve({ data: products.data, response: { status: products.status } });
    }
    return Promise.resolve({ data: opts.profile.data, response: { status: opts.profile.status } });
  });
}

describe('PhotographerProfilePage', () => {
  afterEach(() => {
    vi.resetModules();
    apiGetMock.mockReset();
    headersMock.mockReset();
  });

  it('renders notFound when the photographer profile is missing', async () => {
    mockApi({ profile: { status: 404 } });
    mockHeaders();
    const PhotographerProfilePage = await loadPage();

    const error: unknown = await PhotographerProfilePage({
      params: Promise.resolve({ locale: 'en', slug: 'unknown-photographer' }),
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect((error as { digest?: string }).digest).toMatch(/;404$/);
  });

  it('renders notFound when only the products endpoint 404s', async () => {
    mockApi({ profile: { status: 200, data: PROFILE }, products: { status: 404 } });
    mockHeaders();
    const PhotographerProfilePage = await loadPage();

    const error: unknown = await PhotographerProfilePage({
      params: Promise.resolve({ locale: 'en', slug: 'sofia-martins' }),
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect((error as { digest?: string }).digest).toMatch(/;404$/);
  });

  it('throws a plain error when the profile API fails unexpectedly', async () => {
    mockApi({ profile: { status: 500 } });
    mockHeaders();
    const PhotographerProfilePage = await loadPage();

    await expect(
      PhotographerProfilePage({ params: Promise.resolve({ locale: 'en', slug: 'sofia-martins' }) }),
    ).rejects.toThrow(/HTTP 500/);
  });

  it('throws a plain error when the products API fails unexpectedly', async () => {
    mockApi({ profile: { status: 200, data: PROFILE }, products: { status: 500 } });
    mockHeaders();
    const PhotographerProfilePage = await loadPage();

    await expect(
      PhotographerProfilePage({ params: Promise.resolve({ locale: 'en', slug: 'sofia-martins' }) }),
    ).rejects.toThrow(/products.*HTTP 500/);
  });

  it('always links the CTA straight to the request form', async () => {
    mockApi({ profile: { status: 200, data: PROFILE } });
    mockHeaders();
    const PhotographerProfilePage = await loadPage();

    const { QuoteCta } = await import('./quote-cta');
    const element = await PhotographerProfilePage({
      params: Promise.resolve({ locale: 'en', slug: 'sofia-martins' }),
    });
    const children = (element.props as { children: { type: unknown; props?: { href?: string } }[] })
      .children;
    const cta = children.find((child) => child.type === QuoteCta);
    if (!cta) {
      throw new Error('expected a QuoteCta child');
    }

    expect(cta.props?.href).toBe('/en/requests/new?photographer=sofia-martins');
  });

  it('embeds the JSON-LD script with the request nonce and the configured site URL', async () => {
    mockApi({ profile: { status: 200, data: PROFILE } });
    mockHeaders({ 'x-nonce': 'abc123' });
    const PhotographerProfilePage = await loadPage();

    const element = await PhotographerProfilePage({
      params: Promise.resolve({ locale: 'en', slug: 'sofia-martins' }),
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
    expect(script?.props.dangerouslySetInnerHTML.__html).toContain(
      'http://127.0.0.1:3000/en/photographers/sofia-martins',
    );
  });
});

describe('generateMetadata', () => {
  afterEach(() => {
    vi.resetModules();
    apiGetMock.mockReset();
    headersMock.mockReset();
  });

  async function loadGenerateMetadata() {
    const mod = await import('./page');
    return mod.generateMetadata;
  }

  it('returns absolute canonical, hreflang (including x-default) and Open Graph URLs', async () => {
    mockApi({ profile: { status: 200, data: PROFILE } });
    const generateMetadata = await loadGenerateMetadata();

    const metadata = await generateMetadata({
      params: Promise.resolve({ locale: 'en', slug: 'sofia-martins' }),
    });

    expect(metadata.alternates?.canonical).toBe(
      'http://127.0.0.1:3000/en/photographers/sofia-martins',
    );
    expect(metadata.alternates?.languages).toMatchObject({
      en: 'http://127.0.0.1:3000/en/photographers/sofia-martins',
      fr: 'http://127.0.0.1:3000/fr/photographers/sofia-martins',
      'x-default': 'http://127.0.0.1:3000/en/photographers/sofia-martins',
    });
    expect(metadata.openGraph).toMatchObject({
      url: 'http://127.0.0.1:3000/en/photographers/sofia-martins',
      locale: 'en',
    });
  });

  it('uses the headline as the description when present', async () => {
    mockApi({ profile: { status: 200, data: PROFILE } });
    const generateMetadata = await loadGenerateMetadata();

    const metadata = await generateMetadata({
      params: Promise.resolve({ locale: 'en', slug: 'sofia-martins' }),
    });

    expect(metadata.description).toBe(PROFILE.headline);
  });

  it('truncates a long bio at a word boundary when there is no headline', async () => {
    const longBio =
      'Documentary-style wedding and portrait photography across Luxembourg City and every surrounding commune, available for full-day coverage with second shooters, drone footage and same-week previews for every couple.';
    mockApi({
      profile: { status: 200, data: { ...PROFILE, headline: null, bio: { en: longBio } } },
    });
    const generateMetadata = await loadGenerateMetadata();

    const metadata = await generateMetadata({
      params: Promise.resolve({ locale: 'en', slug: 'sofia-martins' }),
    });

    expect(metadata.description?.length).toBeLessThanOrEqual(161);
    expect(metadata.description?.endsWith('…')).toBe(true);
    expect(longBio.startsWith(metadata.description?.slice(0, -1) ?? '')).toBe(true);
  });

  it('leaves the description undefined when there is no headline or bio', async () => {
    mockApi({
      profile: { status: 200, data: { ...PROFILE, headline: null, bio: {} } },
    });
    const generateMetadata = await loadGenerateMetadata();

    const metadata = await generateMetadata({
      params: Promise.resolve({ locale: 'en', slug: 'sofia-martins' }),
    });

    expect(metadata.description).toBeUndefined();
  });
});

describe('country dispatch', () => {
  afterEach(() => {
    vi.resetModules();
    apiGetMock.mockReset();
    headersMock.mockReset();
    countryLandingMetadataMock.mockReset();
  });

  it('renders the country landing for a 2-letter segment instead of looking up a profile', async () => {
    const PhotographerProfilePage = await loadPage();
    const { CountryLandingPage } = await import('./country-landing');

    const element = await PhotographerProfilePage({
      params: Promise.resolve({ locale: 'en', slug: 'lu' }),
    });

    expect(element.type).toBe(CountryLandingPage);
    expect(element.props).toEqual({ locale: 'en', countryCode: 'LU' });
    expect(apiGetMock).not.toHaveBeenCalled();
  });

  it('still resolves a longer slug as a profile lookup', async () => {
    mockApi({ profile: { status: 200, data: PROFILE } });
    mockHeaders();
    const PhotographerProfilePage = await loadPage();

    const element = await PhotographerProfilePage({
      params: Promise.resolve({ locale: 'en', slug: 'sofia-martins' }),
    });

    expect(element.type).toBe('article');
  });

  it('delegates metadata generation for a 2-letter segment to the country landing', async () => {
    countryLandingMetadataMock.mockResolvedValue({ title: 'Photographers in Luxembourg' });
    const { generateMetadata } = await import('./page');

    const metadata = await generateMetadata({
      params: Promise.resolve({ locale: 'en', slug: 'lu' }),
    });

    expect(countryLandingMetadataMock).toHaveBeenCalledWith({ locale: 'en', countryCode: 'LU' });
    expect(metadata).toEqual({ title: 'Photographers in Luxembourg' });
  });
});
