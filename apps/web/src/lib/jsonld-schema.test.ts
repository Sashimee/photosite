import type { components } from '@photoo/api-client';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { buildItemListJsonLd } from './landing-jsonld';
import { buildJobPostingJsonLd, type PublicJobOffer } from './job-offer-jsonld';
import { buildProfileJsonLd } from './profile-jsonld';

// docs/steps/1B.11-seo.md: "Structured data is validated in CI against the
// schema, not by pasting into Google's tool by hand." profile-jsonld.test.ts,
// landing-jsonld.test.ts and job-offer-jsonld.test.ts already assert the
// exact shape each builder produces for a given fixture; what they don't
// assert is that the result is well-formed for its schema.org type for *any*
// input - i.e. the properties Google's Rich Results requirements treat as
// mandatory are always present with the right shape. That's what these
// schemas check, generically, rather than duplicating the fixture-specific
// coverage above.

const LocalBusinessJsonLdSchema = z.object({
  '@context': z.literal('https://schema.org'),
  '@type': z.string().min(1),
  name: z.string().min(1),
  url: z.url(),
  image: z.url().optional(),
  address: z.object({
    '@type': z.literal('PostalAddress'),
    addressLocality: z.string().min(1),
    addressCountry: z.string().min(1),
  }),
  makesOffer: z.array(
    z.object({
      '@type': z.literal('Offer'),
      itemOffered: z.object({ '@type': z.literal('Service'), name: z.string().min(1) }),
      priceSpecification: z.object({
        '@type': z.literal('PriceSpecification'),
        price: z.string().regex(/^\d+\.\d{2}$/),
        priceCurrency: z.string().length(3),
      }),
    }),
  ),
  aggregateRating: z
    .object({
      '@type': z.literal('AggregateRating'),
      ratingValue: z.number().gt(0),
      ratingCount: z.number().int().positive(),
    })
    .optional(),
});

const ItemListJsonLdSchema = z.object({
  '@context': z.literal('https://schema.org'),
  '@type': z.literal('ItemList'),
  itemListElement: z.array(
    z.object({
      '@type': z.literal('ListItem'),
      position: z.number().int().min(1),
      url: z.url(),
      name: z.string().min(1),
    }),
  ),
});

// Google's Rich Results requirements for JobPosting: title, description,
// hiringOrganization.name, and a way to place it - either jobLocation or
// jobLocationType: TELECOMMUTE. That "or" is the one invariant worth
// asserting generically, since job-offer-jsonld.ts's own comment documents
// it as a rule, not just a fixture outcome.
const JobPostingJsonLdSchema = z
  .object({
    '@context': z.literal('https://schema.org'),
    '@type': z.literal('JobPosting'),
    title: z.string().min(1),
    description: z.string().min(1),
    datePosted: z.string().min(1),
    validThrough: z.string().min(1).optional(),
    hiringOrganization: z.object({
      '@type': z.literal('Organization'),
      name: z.string().min(1),
    }),
    jobLocation: z
      .object({
        '@type': z.literal('Place'),
        address: z.object({
          '@type': z.literal('PostalAddress'),
          addressLocality: z.string().min(1),
          addressCountry: z.string().min(1),
        }),
      })
      .optional(),
    jobLocationType: z.literal('TELECOMMUTE').optional(),
    baseSalary: z
      .object({
        '@type': z.literal('MonetaryAmount'),
        currency: z.string().length(3),
        value: z.object({
          '@type': z.literal('QuantitativeValue'),
          minValue: z.number(),
          maxValue: z.number(),
        }),
      })
      .optional(),
  })
  .refine(
    (jsonLd) => jsonLd.jobLocation !== undefined || jsonLd.jobLocationType === 'TELECOMMUTE',
    {
      message: 'a JobPosting needs jobLocation or jobLocationType: TELECOMMUTE, never neither',
    },
  );

type PublicPhotographerProfile = components['schemas']['PublicPhotographerProfile'];
type Product = components['schemas']['Product'];

function minimalProfile(
  overrides: Partial<PublicPhotographerProfile> = {},
): PublicPhotographerProfile {
  return {
    id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
    slug: 'sofia-martins',
    displayName: 'Sofia Martins',
    headline: null,
    bio: {},
    avatarUrl: null,
    coverUrl: null,
    links: { instagram: null, website: null, behance: null, other: [] },
    categories: ['wedding'],
    languages: ['en'],
    serviceRadiusKm: 30,
    city: 'Luxembourg City',
    countryCode: 'LU',
    ratingAvg: 0,
    ratingCount: 0,
    portfolio: [],
    ...overrides,
  };
}

function minimalProduct(overrides: Partial<Product> = {}): Product {
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

function minimalOffer(overrides: Partial<PublicJobOffer> = {}): PublicJobOffer {
  return {
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
    publishedAt: '2026-09-01T09:00:00.000Z',
    startDate: null,
    endDate: null,
    expiresAt: '2026-10-31T09:00:00.000Z',
    company: {
      id: '4fa85f64-5717-4562-b3fc-2c963f66afa6',
      companyName: 'Acme Studios',
      website: null,
      logoUrl: null,
      verified: false,
    },
    ...overrides,
  };
}

describe('JSON-LD schema validation', () => {
  it('validates a profile with no avatar and no rating as a well-formed LocalBusiness', () => {
    const jsonLd = buildProfileJsonLd({
      profile: minimalProfile(),
      products: [minimalProduct()],
      locale: 'en',
      url: 'https://footoo.bas.lu/en/photographers/sofia-martins',
    });

    expect(() => LocalBusinessJsonLdSchema.parse(jsonLd)).not.toThrow();
  });

  it('validates a profile with an avatar and a rating as a well-formed LocalBusiness', () => {
    const jsonLd = buildProfileJsonLd({
      profile: minimalProfile({
        avatarUrl: 'https://footoo.bas.lu/photoo-public/seed/sofia-martins/avatar/medium.jpg',
        ratingAvg: 4.8,
        ratingCount: 12,
      }),
      products: [],
      locale: 'en',
      url: 'https://footoo.bas.lu/en/photographers/sofia-martins',
    });

    expect(() => LocalBusinessJsonLdSchema.parse(jsonLd)).not.toThrow();
  });

  it('validates an ItemList of search results as well-formed', () => {
    const jsonLd = buildItemListJsonLd({
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
      urlFor: (slug) => `https://photoo.lu/en/photographers/${slug}`,
    });

    expect(() => ItemListJsonLdSchema.parse(jsonLd)).not.toThrow();
  });

  it('validates a non-remote job offer as a well-formed JobPosting with a jobLocation', () => {
    const jsonLd = buildJobPostingJsonLd({ offer: minimalOffer() });

    expect(() => JobPostingJsonLdSchema.parse(jsonLd)).not.toThrow();
  });

  it('validates a fully remote job offer as a well-formed JobPosting via jobLocationType', () => {
    const jsonLd = buildJobPostingJsonLd({
      offer: minimalOffer({ remote: true, location: null }),
    });

    expect(() => JobPostingJsonLdSchema.parse(jsonLd)).not.toThrow();
  });

  it('rejects a JobPosting-shaped object with neither jobLocation nor jobLocationType', () => {
    const invalid = {
      '@context': 'https://schema.org',
      '@type': 'JobPosting',
      title: 'Wedding photographer needed',
      description: 'Full day coverage.',
      datePosted: '2026-09-01T09:00:00.000Z',
      hiringOrganization: { '@type': 'Organization', name: 'Acme Studios' },
    };

    expect(() => JobPostingJsonLdSchema.parse(invalid)).toThrow();
  });
});
