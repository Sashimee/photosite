import { describe, expect, it } from 'vitest';
import {
  AttachPortfolioImageRequestSchema,
  CreatePhotographerProfileRequestSchema,
  OwnPhotographerProfileSchema,
  PhotographerSearchQuerySchema,
  PhotographerSummarySchema,
  PortfolioImageSchema,
  PublicPhotographerProfileSchema,
  PublicPortfolioImageSchema,
  UpdatePhotographerProfileRequestSchema,
} from './profiles.js';

const validPortfolioImage = {
  id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  url: 'https://cdn.photoo.lu/portfolio/abc123.jpg',
  width: 1600,
  height: 900,
  order: 0,
  status: 'approved',
};

const validPublicProfile = {
  id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  slug: 'jane-doe-photography',
  displayName: 'Jane Doe Photography',
  headline: 'Weddings and portraits in Luxembourg',
  bio: { en: 'Wedding and portrait photographer in Luxembourg' },
  avatarUrl: 'https://cdn.photoo.lu/avatars/jane.jpg',
  coverUrl: null,
  links: { instagram: 'https://instagram.com/jane', other: [] },
  categories: ['wedding', 'portrait'],
  languages: ['en', 'fr'],
  serviceRadiusKm: 50,
  city: 'Luxembourg',
  countryCode: 'LU',
  ratingAvg: 4.8,
  ratingCount: 12,
  portfolio: [
    {
      id: validPortfolioImage.id,
      url: validPortfolioImage.url,
      width: 1600,
      height: 900,
      order: 0,
    },
  ],
};

describe('PublicPhotographerProfileSchema', () => {
  it('accepts a well-formed public profile', () => {
    expect(PublicPhotographerProfileSchema.safeParse(validPublicProfile).success).toBe(true);
  });

  it('rejects exact coordinates so a home-based photographer is not located publicly', () => {
    expect(
      PublicPhotographerProfileSchema.safeParse({
        ...validPublicProfile,
        location: { lat: 49.6116, lng: 6.1319 },
      }).success,
    ).toBe(false);
  });

  it('rejects a stripeAccountId field', () => {
    expect(
      PublicPhotographerProfileSchema.safeParse({
        ...validPublicProfile,
        stripeAccountId: 'acct_123',
      }).success,
    ).toBe(false);
  });

  it('rejects an email field', () => {
    expect(
      PublicPhotographerProfileSchema.safeParse({ ...validPublicProfile, email: 'x@example.com' })
        .success,
    ).toBe(false);
  });

  it('rejects a portfolio image carrying a status field', () => {
    expect(
      PublicPhotographerProfileSchema.safeParse({
        ...validPublicProfile,
        portfolio: [validPortfolioImage],
      }).success,
    ).toBe(false);
  });

  it('rejects an unsupported locale key in bio', () => {
    expect(
      PublicPhotographerProfileSchema.safeParse({ ...validPublicProfile, bio: { it: 'Ciao' } })
        .success,
    ).toBe(false);
  });
});

describe('PhotographerSummarySchema', () => {
  it('accepts a summary without verification or stripe fields', () => {
    const result = PhotographerSummarySchema.safeParse({
      id: validPublicProfile.id,
      slug: validPublicProfile.slug,
      displayName: validPublicProfile.displayName,
      headline: validPublicProfile.headline,
      avatarUrl: validPublicProfile.avatarUrl,
      categories: validPublicProfile.categories,
      languages: validPublicProfile.languages,
      city: validPublicProfile.city,
      countryCode: validPublicProfile.countryCode,
      ratingAvg: validPublicProfile.ratingAvg,
      ratingCount: validPublicProfile.ratingCount,
      startingPrice: { amountCents: 15000, currency: 'EUR' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects a verificationStatus field', () => {
    const result = PhotographerSummarySchema.safeParse({
      id: validPublicProfile.id,
      slug: validPublicProfile.slug,
      displayName: validPublicProfile.displayName,
      headline: validPublicProfile.headline,
      avatarUrl: validPublicProfile.avatarUrl,
      categories: validPublicProfile.categories,
      languages: validPublicProfile.languages,
      city: validPublicProfile.city,
      countryCode: validPublicProfile.countryCode,
      ratingAvg: validPublicProfile.ratingAvg,
      ratingCount: validPublicProfile.ratingCount,
      startingPrice: null,
      verificationStatus: 'verified',
    });
    expect(result.success).toBe(false);
  });
});

describe('OwnPhotographerProfileSchema', () => {
  it('accepts stripe onboarding flags but not the stripeAccountId', () => {
    const valid = {
      ...Object.fromEntries(
        Object.entries(validPublicProfile).filter(([key]) => key !== 'portfolio'),
      ),
      location: { lat: 49.6116, lng: 6.1319 },
      verificationStatus: 'verified',
      isPublished: true,
      stripeOnboardingComplete: true,
      stripePayoutsEnabled: true,
    };
    expect(OwnPhotographerProfileSchema.safeParse(valid).success).toBe(true);
    expect(
      OwnPhotographerProfileSchema.safeParse({ ...valid, stripeAccountId: 'acct_123' }).success,
    ).toBe(false);
  });
});

describe('PortfolioImageSchema and PublicPortfolioImageSchema', () => {
  it('owner schema accepts a status', () => {
    expect(PortfolioImageSchema.safeParse(validPortfolioImage).success).toBe(true);
  });

  it('public schema rejects a status field', () => {
    expect(PublicPortfolioImageSchema.safeParse(validPortfolioImage).success).toBe(false);
  });

  it('public schema accepts the image without status', () => {
    const { id, url, width, height, order } = validPortfolioImage;
    expect(PublicPortfolioImageSchema.safeParse({ id, url, width, height, order }).success).toBe(
      true,
    );
  });
});

describe('UpdatePhotographerProfileRequestSchema', () => {
  it('accepts a partial update', () => {
    expect(
      UpdatePhotographerProfileRequestSchema.safeParse({ displayName: 'New name' }).success,
    ).toBe(true);
  });

  it('rejects an empty categories array', () => {
    expect(UpdatePhotographerProfileRequestSchema.safeParse({ categories: [] }).success).toBe(
      false,
    );
  });

  it('rejects unknown keys', () => {
    expect(
      UpdatePhotographerProfileRequestSchema.safeParse({ stripeAccountId: 'acct_123' }).success,
    ).toBe(false);
  });

  it('accepts a null avatarUploadId and coverUploadId', () => {
    expect(
      UpdatePhotographerProfileRequestSchema.safeParse({
        avatarUploadId: null,
        coverUploadId: null,
      }).success,
    ).toBe(true);
  });

  it('accepts an avatarUploadId set to an upload id', () => {
    expect(
      UpdatePhotographerProfileRequestSchema.safeParse({
        avatarUploadId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
      }).success,
    ).toBe(true);
  });

  it('rejects an avatarUploadId that is not a uuid', () => {
    expect(
      UpdatePhotographerProfileRequestSchema.safeParse({ avatarUploadId: 'not-a-uuid' }).success,
    ).toBe(false);
  });
});

describe('CreatePhotographerProfileRequestSchema', () => {
  const validCreate = {
    displayName: 'Jane Doe Photography',
    categories: ['wedding', 'portrait'],
    languages: ['en', 'fr'],
    location: { lat: 49.6116, lng: 6.1319 },
    city: 'Luxembourg',
    countryCode: 'LU',
  };

  it('accepts the required fields only', () => {
    expect(CreatePhotographerProfileRequestSchema.safeParse(validCreate).success).toBe(true);
  });

  it('accepts optional fields alongside the required ones', () => {
    expect(
      CreatePhotographerProfileRequestSchema.safeParse({
        ...validCreate,
        headline: 'Weddings and portraits in Luxembourg',
        bio: { en: 'Wedding and portrait photographer' },
        links: { other: [] },
        serviceRadiusKm: 50,
      }).success,
    ).toBe(true);
  });

  it.each(['displayName', 'categories', 'languages', 'location', 'city', 'countryCode'])(
    'rejects a missing %s',
    (field) => {
      const rest = Object.fromEntries(Object.entries(validCreate).filter(([key]) => key !== field));
      expect(CreatePhotographerProfileRequestSchema.safeParse(rest).success).toBe(false);
    },
  );

  it('rejects an avatarUploadId field', () => {
    expect(
      CreatePhotographerProfileRequestSchema.safeParse({
        ...validCreate,
        avatarUploadId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
      }).success,
    ).toBe(false);
  });

  it('rejects an empty categories array', () => {
    expect(
      CreatePhotographerProfileRequestSchema.safeParse({ ...validCreate, categories: [] }).success,
    ).toBe(false);
  });
});

describe('AttachPortfolioImageRequestSchema', () => {
  it('accepts a valid uploadId', () => {
    expect(
      AttachPortfolioImageRequestSchema.safeParse({
        uploadId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
      }).success,
    ).toBe(true);
  });

  it('rejects a missing uploadId', () => {
    expect(AttachPortfolioImageRequestSchema.safeParse({}).success).toBe(false);
  });

  it('rejects unknown keys', () => {
    expect(
      AttachPortfolioImageRequestSchema.safeParse({
        uploadId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
        order: 0,
      }).success,
    ).toBe(false);
  });
});

describe('PhotographerSearchQuerySchema', () => {
  it('accepts a city search with defaults', () => {
    const result = PhotographerSearchQuerySchema.safeParse({ city: 'Luxembourg' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(20);
    }
  });

  it('accepts a geo search with lat, lng and radiusKm', () => {
    expect(
      PhotographerSearchQuerySchema.safeParse({ lat: '49.6', lng: '6.1', radiusKm: '25' }).success,
    ).toBe(true);
  });

  it('rejects lat without lng', () => {
    expect(PhotographerSearchQuerySchema.safeParse({ lat: '49.6' }).success).toBe(false);
  });

  it('rejects priceMinCents greater than priceMaxCents', () => {
    expect(
      PhotographerSearchQuerySchema.safeParse({ priceMinCents: '500', priceMaxCents: '100' })
        .success,
    ).toBe(false);
  });

  it('rejects limit outside 1..100', () => {
    expect(PhotographerSearchQuerySchema.safeParse({ limit: '0' }).success).toBe(false);
    expect(PhotographerSearchQuerySchema.safeParse({ limit: '101' }).success).toBe(false);
  });

  it('rejects unknown keys', () => {
    expect(PhotographerSearchQuerySchema.safeParse({ sort: 'price' }).success).toBe(false);
  });
});
