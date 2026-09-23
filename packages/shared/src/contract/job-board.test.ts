import { describe, expect, it } from 'vitest';
import {
  CompensationSchema,
  CreateJobApplicationRequestSchema,
  CreateJobOfferRequestSchema,
  CreateListingRequestSchema,
  JobOfferSchema,
  JobOffersQuerySchema,
  PortfolioLinkSchema,
  PublicJobOfferSchema,
  PublicJobOfferSummarySchema,
  UpdateJobApplicationStatusRequestSchema,
} from './job-board.js';

const id = '3fa85f64-5717-4562-b3fc-2c963f66afa6';
const location = { lat: 49.6116, lng: 6.1319 };

const company = {
  id,
  companyName: 'Studio Doe s.à r.l.',
  website: 'https://studio-doe.lu',
  logoUrl: 'https://cdn.photoo.lu/logos/abc123.png',
  verified: true,
};

const validCreateOffer = {
  title: 'Wedding photographer needed',
  description: 'Full-day coverage for a corporate event',
  category: 'corporate',
  city: 'Luxembourg',
  countryCode: 'LU',
  location,
  remote: false,
};

describe('PortfolioLinkSchema', () => {
  it('accepts an https URL', () => {
    expect(PortfolioLinkSchema.safeParse('https://example.com/portfolio').success).toBe(true);
  });

  it('rejects an http URL', () => {
    expect(PortfolioLinkSchema.safeParse('http://example.com/portfolio').success).toBe(false);
  });

  it('rejects a javascript: URL', () => {
    expect(PortfolioLinkSchema.safeParse('javascript:alert(1)').success).toBe(false);
  });

  it('normalises the host to lowercase and drops the default port', () => {
    const result = PortfolioLinkSchema.safeParse('https://EXAMPLE.com:443/Portfolio');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe('https://example.com/Portfolio');
    }
  });
});

describe('CompensationSchema', () => {
  it('accepts a well-formed range', () => {
    expect(
      CompensationSchema.safeParse({
        min: { amountCents: 10000, currency: 'EUR' },
        max: { amountCents: 20000, currency: 'EUR' },
      }).success,
    ).toBe(true);
  });

  it('rejects min greater than max', () => {
    expect(
      CompensationSchema.safeParse({
        min: { amountCents: 30000, currency: 'EUR' },
        max: { amountCents: 20000, currency: 'EUR' },
      }).success,
    ).toBe(false);
  });

  it('rejects mismatched currencies', () => {
    expect(
      CompensationSchema.safeParse({
        min: { amountCents: 10000, currency: 'EUR' },
        max: { amountCents: 20000, currency: 'USD' },
      }).success,
    ).toBe(false);
  });
});

describe('CreateJobOfferRequestSchema', () => {
  it('accepts a well-formed offer', () => {
    expect(CreateJobOfferRequestSchema.safeParse(validCreateOffer).success).toBe(true);
  });

  it('accepts a remote offer with a compensation range', () => {
    expect(
      CreateJobOfferRequestSchema.safeParse({
        ...validCreateOffer,
        remote: true,
        compensation: {
          min: { amountCents: 10000, currency: 'EUR' },
          max: { amountCents: 20000, currency: 'EUR' },
        },
      }).success,
    ).toBe(true);
  });

  it('rejects a status field', () => {
    expect(
      CreateJobOfferRequestSchema.safeParse({ ...validCreateOffer, status: 'published' }).success,
    ).toBe(false);
  });

  it('rejects an unknown category', () => {
    expect(
      CreateJobOfferRequestSchema.safeParse({ ...validCreateOffer, category: 'landscape' }).success,
    ).toBe(false);
  });
});

describe('JobOfferSchema', () => {
  const validOffer = {
    id,
    slug: 'wedding-photographer-needed-ab12',
    ...validCreateOffer,
    startDate: null,
    endDate: null,
    compensation: null,
    status: 'published',
    publishedAt: '2026-09-16T12:00:00.000Z',
    expiresAt: '2026-11-15T12:00:00.000Z',
  };

  it('accepts a published offer', () => {
    expect(JobOfferSchema.safeParse(validOffer).success).toBe(true);
  });

  it('rejects a slug with uppercase letters', () => {
    expect(JobOfferSchema.safeParse({ ...validOffer, slug: 'Wedding-Photographer' }).success).toBe(
      false,
    );
  });

  it('rejects a slug with a leading hyphen', () => {
    expect(JobOfferSchema.safeParse({ ...validOffer, slug: '-wedding-ab12' }).success).toBe(false);
  });

  it('rejects a slug shorter than 3 characters', () => {
    expect(JobOfferSchema.safeParse({ ...validOffer, slug: 'ab' }).success).toBe(false);
  });
});

describe('PublicJobOfferSummarySchema and PublicJobOfferSchema', () => {
  const validSummary = {
    id,
    slug: 'wedding-photographer-needed-ab12',
    title: validCreateOffer.title,
    category: validCreateOffer.category,
    city: validCreateOffer.city,
    countryCode: validCreateOffer.countryCode,
    location,
    remote: false,
    compensation: null,
    publishedAt: '2026-09-16T12:00:00.000Z',
    company,
  };

  it('accepts a well-formed summary', () => {
    expect(PublicJobOfferSummarySchema.safeParse(validSummary).success).toBe(true);
  });

  it('rejects a summary carrying the professional vatNumber', () => {
    expect(
      PublicJobOfferSummarySchema.safeParse({
        ...validSummary,
        company: { ...company, vatNumber: 'LU12345678' },
      }).success,
    ).toBe(false);
  });

  it('rejects a summary carrying a professional email', () => {
    expect(
      PublicJobOfferSummarySchema.safeParse({
        ...validSummary,
        company: { ...company, email: 'owner@studio-doe.lu' },
      }).success,
    ).toBe(false);
  });

  it('accepts a well-formed detail with description and expiresAt', () => {
    expect(
      PublicJobOfferSchema.safeParse({
        ...validSummary,
        description: validCreateOffer.description,
        startDate: null,
        endDate: null,
        expiresAt: '2026-11-15T12:00:00.000Z',
      }).success,
    ).toBe(true);
  });

  it('rejects a draft-shaped offer missing publishedAt', () => {
    expect(
      PublicJobOfferSchema.safeParse({
        ...validSummary,
        publishedAt: null,
        description: validCreateOffer.description,
        startDate: null,
        endDate: null,
        expiresAt: '2026-11-15T12:00:00.000Z',
      }).success,
    ).toBe(false);
  });
});

describe('JobOffersQuerySchema', () => {
  it('accepts an empty query', () => {
    expect(JobOffersQuerySchema.safeParse({}).success).toBe(true);
  });

  it('coerces remote from the query string', () => {
    expect(JobOffersQuerySchema.parse({ remote: 'true' }).remote).toBe(true);
  });

  it('rejects a malformed limit', () => {
    expect(JobOffersQuerySchema.safeParse({ limit: 0 }).success).toBe(false);
  });
});

describe('CreateJobApplicationRequestSchema', () => {
  it('accepts a message with an https portfolio link', () => {
    expect(
      CreateJobApplicationRequestSchema.safeParse({
        message: 'I would love to shoot this event',
        portfolioLink: 'https://example.com/portfolio',
      }).success,
    ).toBe(true);
  });

  it('accepts a message without a portfolio link', () => {
    expect(CreateJobApplicationRequestSchema.safeParse({ message: 'Interested!' }).success).toBe(
      true,
    );
  });

  it('rejects an http portfolio link', () => {
    expect(
      CreateJobApplicationRequestSchema.safeParse({
        message: 'Interested!',
        portfolioLink: 'http://example.com/portfolio',
      }).success,
    ).toBe(false);
  });

  it('rejects an empty message', () => {
    expect(CreateJobApplicationRequestSchema.safeParse({ message: '' }).success).toBe(false);
  });
});

describe('UpdateJobApplicationStatusRequestSchema', () => {
  it('accepts each known status', () => {
    for (const status of ['submitted', 'shortlisted', 'rejected', 'withdrawn']) {
      expect(UpdateJobApplicationStatusRequestSchema.safeParse({ status }).success).toBe(true);
    }
  });

  it('rejects an unknown status', () => {
    expect(UpdateJobApplicationStatusRequestSchema.safeParse({ status: 'hired' }).success).toBe(
      false,
    );
  });
});

describe('CreateListingRequestSchema', () => {
  it('accepts a free job_offer listing', () => {
    expect(CreateListingRequestSchema.safeParse({ kind: 'job_offer', plan: 'free' }).success).toBe(
      true,
    );
  });

  it('rejects a paid plan', () => {
    expect(CreateListingRequestSchema.safeParse({ kind: 'job_offer', plan: 'paid' }).success).toBe(
      false,
    );
  });

  it('rejects a featured plan', () => {
    expect(
      CreateListingRequestSchema.safeParse({ kind: 'job_offer', plan: 'featured' }).success,
    ).toBe(false);
  });
});
