import type { components } from '@photoo/api-client';
import { describe, expect, it } from 'vitest';

import { buildProfileJsonLd, serializeJsonLd } from './profile-jsonld';

type PublicPhotographerProfile = components['schemas']['PublicPhotographerProfile'];
type Product = components['schemas']['Product'];

function makeProfile(
  overrides: Partial<PublicPhotographerProfile> = {},
): PublicPhotographerProfile {
  return {
    id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
    slug: 'sofia-martins',
    displayName: 'Sofia Martins',
    headline: 'Wedding and portrait photographer',
    bio: { en: 'Documentary-style wedding photography.' },
    avatarUrl: 'https://footoo.bas.lu/photoo-public/seed/sofia-martins/avatar/medium.jpg',
    coverUrl: 'https://footoo.bas.lu/photoo-public/seed/sofia-martins/cover/large.jpg',
    links: { instagram: null, website: null, behance: null, other: [] },
    categories: ['wedding', 'portrait'],
    languages: ['fr', 'en', 'pt'],
    serviceRadiusKm: 30,
    city: 'Luxembourg City',
    countryCode: 'LU',
    ratingAvg: 4.8,
    ratingCount: 12,
    portfolio: [],
    ...overrides,
  };
}

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 'b1a5f64c-5717-4562-b3fc-2c963f66afa6',
    profileId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
    title: { en: 'Wedding day coverage' },
    description: null,
    category: 'wedding',
    durationMinutes: 480,
    deliverables: {},
    basePrice: { amountCents: 250000, currency: 'EUR' },
    isActive: true,
    order: 1,
    tiers: [
      {
        id: 'c1a5f64c-5717-4562-b3fc-2c963f66afa6',
        usage: 'personal',
        price: { amountCents: 250000, currency: 'EUR' },
        description: 'For personal, non-commercial use only.',
        licenceTextVersion: 'v1',
      },
    ],
    ...overrides,
  };
}

describe('buildProfileJsonLd', () => {
  it('builds a ProfessionalService with an offer per active product tier', () => {
    const jsonLd = buildProfileJsonLd({
      profile: makeProfile(),
      products: [makeProduct()],
      locale: 'en',
      url: 'https://footoo.bas.lu/en/photographers/sofia-martins',
    });

    expect(jsonLd).toMatchObject({
      '@context': 'https://schema.org',
      '@type': 'ProfessionalService',
      name: 'Sofia Martins',
      url: 'https://footoo.bas.lu/en/photographers/sofia-martins',
      image: 'https://footoo.bas.lu/photoo-public/seed/sofia-martins/avatar/medium.jpg',
      address: {
        '@type': 'PostalAddress',
        addressLocality: 'Luxembourg City',
        addressCountry: 'LU',
      },
      areaServed: 'Luxembourg City',
      knowsLanguage: ['fr', 'en', 'pt'],
      founder: { '@type': 'Person', name: 'Sofia Martins' },
    });
    expect(jsonLd.makesOffer).toEqual([
      {
        '@type': 'Offer',
        itemOffered: { '@type': 'Service', name: 'Wedding day coverage (Personal use)' },
        priceSpecification: {
          '@type': 'PriceSpecification',
          price: '2500.00',
          priceCurrency: 'EUR',
        },
      },
    ]);
  });

  it('distinguishes offers for the same product by licence usage', () => {
    const jsonLd = buildProfileJsonLd({
      profile: makeProfile(),
      products: [
        makeProduct({
          tiers: [
            {
              id: 'c1a5f64c-5717-4562-b3fc-2c963f66afa6',
              usage: 'personal',
              price: { amountCents: 250000, currency: 'EUR' },
              description: 'For personal, non-commercial use only.',
              licenceTextVersion: 'v1',
            },
            {
              id: 'd1a5f64c-5717-4562-b3fc-2c963f66afa6',
              usage: 'commercial',
              price: { amountCents: 400000, currency: 'EUR' },
              description: 'Licensed for commercial and marketing use.',
              licenceTextVersion: 'v1',
            },
          ],
        }),
      ],
      locale: 'en',
      url: 'https://footoo.bas.lu/en/photographers/sofia-martins',
    });

    expect(jsonLd.makesOffer).toMatchObject([
      { itemOffered: { name: 'Wedding day coverage (Personal use)' } },
      { itemOffered: { name: 'Wedding day coverage (Commercial use)' } },
    ]);
  });

  it('omits aggregateRating when ratingCount is zero', () => {
    const jsonLd = buildProfileJsonLd({
      profile: makeProfile({ ratingCount: 0, ratingAvg: 0 }),
      products: [],
      locale: 'en',
      url: 'https://footoo.bas.lu/en/photographers/sofia-martins',
    });

    expect(jsonLd).not.toHaveProperty('aggregateRating');
  });

  it('includes aggregateRating when ratingCount is greater than zero', () => {
    const jsonLd = buildProfileJsonLd({
      profile: makeProfile({ ratingCount: 12, ratingAvg: 4.8 }),
      products: [],
      locale: 'en',
      url: 'https://footoo.bas.lu/en/photographers/sofia-martins',
    });

    expect(jsonLd.aggregateRating).toEqual({
      '@type': 'AggregateRating',
      ratingValue: 4.8,
      ratingCount: 12,
    });
  });

  it('skips inactive products', () => {
    const jsonLd = buildProfileJsonLd({
      profile: makeProfile(),
      products: [makeProduct({ isActive: false })],
      locale: 'en',
      url: 'https://footoo.bas.lu/en/photographers/sofia-martins',
    });

    expect(jsonLd.makesOffer).toEqual([]);
  });

  it('throws if an active product tier has no price (a malformed API response)', () => {
    expect(() =>
      buildProfileJsonLd({
        profile: makeProfile(),
        products: [
          makeProduct({
            tiers: [
              {
                id: 'd1a5f64c-5717-4562-b3fc-2c963f66afa6',
                usage: 'commercial',
                price: null,
                description: 'Licensed for commercial use.',
                licenceTextVersion: 'v1',
              },
            ],
          }),
        ],
        locale: 'en',
        url: 'https://footoo.bas.lu/en/photographers/sofia-martins',
      }),
    ).toThrow(/to have a price/);
  });
});

describe('serializeJsonLd', () => {
  it('escapes characters that could close the surrounding script tag', () => {
    const serialized = serializeJsonLd({ name: '</script><script>alert(1)</script>&"' });

    expect(serialized).not.toContain('<');
    expect(serialized).not.toContain('>');
    expect(serialized).toContain('\\u003c/script\\u003e');
    expect(serialized).toContain('\\u0026');
  });
});
