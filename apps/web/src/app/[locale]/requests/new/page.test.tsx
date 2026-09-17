import { afterEach, describe, expect, it, vi } from 'vitest';

import { translate } from '@/testing/mock-translations';

const getSessionMock = vi.fn();
const apiGetMock = vi.fn();

vi.mock('@/lib/session', () => ({ getSession: getSessionMock }));
vi.mock('@/lib/api', () => ({ api: { GET: apiGetMock } }));
vi.mock('next-intl/server', () => ({
  getTranslations:
    ({ namespace }: { namespace: string }) =>
    (key: string, values?: Record<string, unknown>) =>
      translate(namespace, key, values),
}));

const COUNTRIES = [{ code: 'LU', name: 'Luxembourg', currency: 'EUR', defaultLocale: 'en' }];

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

function mockApi({
  photographer,
}: {
  photographer?: { profile?: unknown; products?: unknown } | null;
} = {}) {
  apiGetMock.mockImplementation((url: string) => {
    if (url === '/v1/countries') {
      return Promise.resolve({ data: COUNTRIES, response: { status: 200 } });
    }
    if (url === '/v1/photographers/{slug}') {
      return Promise.resolve(
        photographer?.profile
          ? { data: photographer.profile, response: { status: 200 } }
          : { data: undefined, response: { status: 404 } },
      );
    }
    if (url === '/v1/photographers/{slug}/products') {
      return Promise.resolve(
        photographer?.products
          ? { data: photographer.products, response: { status: 200 } }
          : { data: undefined, response: { status: 404 } },
      );
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

describe('NewRequestPage', () => {
  afterEach(() => {
    vi.resetModules();
    getSessionMock.mockReset();
    apiGetMock.mockReset();
  });

  it('redirects to sign-in with the sanitised next path when signed out', async () => {
    getSessionMock.mockResolvedValue(null);
    const NewRequestPage = await loadPage();

    const digest = await redirectDigest(
      NewRequestPage({
        params: Promise.resolve({ locale: 'en' }),
        searchParams: Promise.resolve({ photographer: 'sofia-martins' }),
      }),
    );

    expect(digest).toContain(
      '/en/sign-in?next=%2Fen%2Frequests%2Fnew%3Fphotographer%3Dsofia-martins',
    );
  });

  it('drops an invalid photographer slug from the next path', async () => {
    getSessionMock.mockResolvedValue(null);
    const NewRequestPage = await loadPage();

    const digest = await redirectDigest(
      NewRequestPage({
        params: Promise.resolve({ locale: 'en' }),
        searchParams: Promise.resolve({ photographer: '../evil' }),
      }),
    );

    expect(digest).toContain('/en/sign-in?next=%2Fen%2Frequests%2Fnew');
    expect(digest).not.toContain('evil');
  });

  it('redirects to sign-in with no photographer param when none is given', async () => {
    getSessionMock.mockResolvedValue(null);
    const NewRequestPage = await loadPage();

    const digest = await redirectDigest(
      NewRequestPage({
        params: Promise.resolve({ locale: 'en' }),
        searchParams: Promise.resolve({}),
      }),
    );

    expect(digest).toContain(encodeURIComponent('/en/requests/new'));
    expect(digest).not.toContain('photographer');
  });

  it('renders the form without a photographer preview when none is requested', async () => {
    getSessionMock.mockResolvedValue({ id: 'user-1' });
    mockApi();
    const NewRequestPage = await loadPage();
    const { RequestForm } = await import('./request-form');

    const element = await NewRequestPage({
      params: Promise.resolve({ locale: 'en' }),
      searchParams: Promise.resolve({}),
    });

    const children = (element.props as { children: unknown[] }).children;
    const form = children.find(
      (child): child is { type: unknown; props: { countries: unknown } } =>
        typeof child === 'object' &&
        child !== null &&
        'type' in child &&
        child.type === RequestForm,
    );
    expect(form).toBeDefined();
    expect(form?.props.countries).toEqual(COUNTRIES);
    expect(apiGetMock).not.toHaveBeenCalledWith('/v1/photographers/{slug}', expect.anything());
  });

  it('renders the photographer preview and a link back to the profile when requested', async () => {
    getSessionMock.mockResolvedValue({ id: 'user-1' });
    mockApi({ photographer: { profile: PROFILE, products: [] } });
    const NewRequestPage = await loadPage();
    const { PhotographerPreview } = await import('./photographer-preview');

    const element = await NewRequestPage({
      params: Promise.resolve({ locale: 'en' }),
      searchParams: Promise.resolve({ photographer: 'sofia-martins' }),
    });

    const children = (element.props as { children: unknown[] }).children;
    const previewWrapper = children[1] as { props: { children: unknown[] } };
    const [backLink, preview] = previewWrapper.props.children as [
      { props: { href: string } },
      { type: unknown; props: { slug: string } },
    ];

    expect(backLink.props.href).toBe('/en/photographers/sofia-martins');
    expect(preview.type).toBe(PhotographerPreview);
    expect(preview.props.slug).toBe('sofia-martins');
  });

  it('falls back to the plain form when the photographer profile cannot be found', async () => {
    getSessionMock.mockResolvedValue({ id: 'user-1' });
    mockApi({ photographer: null });
    const NewRequestPage = await loadPage();

    const element = await NewRequestPage({
      params: Promise.resolve({ locale: 'en' }),
      searchParams: Promise.resolve({ photographer: 'sofia-martins' }),
    });

    const children = (element.props as { children: unknown[] }).children;
    expect(children[1]).toBeNull();
  });

  it('throws loudly when the countries endpoint fails', async () => {
    getSessionMock.mockResolvedValue({ id: 'user-1' });
    apiGetMock.mockImplementation((url: string) =>
      url === '/v1/countries'
        ? Promise.resolve({ data: undefined, response: { status: 500 } })
        : Promise.resolve({ data: undefined, response: { status: 404 } }),
    );
    const NewRequestPage = await loadPage();

    await expect(
      NewRequestPage({
        params: Promise.resolve({ locale: 'en' }),
        searchParams: Promise.resolve({}),
      }),
    ).rejects.toThrow(/countries.*HTTP 500/i);
  });
});
