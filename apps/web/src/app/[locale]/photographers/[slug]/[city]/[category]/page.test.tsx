import { afterEach, describe, expect, it, vi } from 'vitest';

import { translate } from '@/testing/mock-translations';

const resolveCategoryLandingMock = vi.fn();
const headersMock = vi.fn();

vi.mock('../../landing-data', () => ({ resolveCategoryLanding: resolveCategoryLandingMock }));
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

describe('generateMetadata (category landing)', () => {
  afterEach(() => {
    vi.resetModules();
    resolveCategoryLandingMock.mockReset();
  });

  it('returns empty metadata for an unknown category, without resolving the city', async () => {
    const { generateMetadata } = await import('./page');

    const metadata = await generateMetadata({
      params: Promise.resolve({
        locale: 'en',
        slug: 'lu',
        city: 'luxembourg-city',
        category: 'landscape',
      }),
    });

    expect(metadata).toEqual({});
    expect(resolveCategoryLandingMock).not.toHaveBeenCalled();
  });

  it('returns empty metadata for an unknown city', async () => {
    resolveCategoryLandingMock.mockResolvedValue(null);
    const { generateMetadata } = await import('./page');

    const metadata = await generateMetadata({
      params: Promise.resolve({
        locale: 'en',
        slug: 'lu',
        city: 'unknown-city',
        category: 'wedding',
      }),
    });

    expect(metadata).toEqual({});
  });
});

describe('CategoryLandingPage', () => {
  afterEach(() => {
    vi.resetModules();
    resolveCategoryLandingMock.mockReset();
    headersMock.mockReset();
  });

  it('404s for an unknown category', async () => {
    mockHeaders();
    const { default: CategoryLandingPage } = await import('./page');

    const error: unknown = await CategoryLandingPage({
      params: Promise.resolve({
        locale: 'en',
        slug: 'lu',
        city: 'luxembourg-city',
        category: 'landscape',
      }),
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect((error as { digest?: string }).digest).toMatch(/;404$/);
  });

  it('404s for an unknown city with a valid category', async () => {
    resolveCategoryLandingMock.mockResolvedValue(null);
    mockHeaders();
    const { default: CategoryLandingPage } = await import('./page');

    const error: unknown = await CategoryLandingPage({
      params: Promise.resolve({
        locale: 'en',
        slug: 'lu',
        city: 'unknown-city',
        category: 'wedding',
      }),
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect((error as { digest?: string }).digest).toMatch(/;404$/);
  });

  it('renders results with escaped ItemList JSON-LD when the category resolves', async () => {
    resolveCategoryLandingMock.mockResolvedValue({
      city: CITY,
      cities: [CITY],
      category: 'wedding',
      photographers: {
        items: [
          {
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
          },
        ],
        nextCursor: null,
      },
    });
    mockHeaders({ 'x-nonce': 'abc123' });
    const { default: CategoryLandingPage } = await import('./page');

    const element = await CategoryLandingPage({
      params: Promise.resolve({
        locale: 'en',
        slug: 'lu',
        city: 'luxembourg-city',
        category: 'wedding',
      }),
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
