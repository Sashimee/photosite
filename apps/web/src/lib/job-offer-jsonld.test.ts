import { describe, expect, it } from 'vitest';

import { buildJobPostingJsonLd, type PublicJobOffer } from './job-offer-jsonld';
import { serializeJsonLd } from './profile-jsonld';

function makeOffer(overrides: Partial<PublicJobOffer> = {}): PublicJobOffer {
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
      website: 'https://acme.example',
      logoUrl: 'https://cdn.example/logo.png',
      verified: true,
    },
    ...overrides,
  };
}

describe('buildJobPostingJsonLd', () => {
  it('builds a JobPosting with the honest fields for a non-remote offer', () => {
    const jsonLd = buildJobPostingJsonLd({ offer: makeOffer() });

    expect(jsonLd).toEqual({
      '@context': 'https://schema.org',
      '@type': 'JobPosting',
      title: 'Wedding photographer needed',
      description: 'Full day coverage for a wedding in Luxembourg City.',
      datePosted: '2026-09-01T09:00:00.000Z',
      validThrough: '2026-10-31T09:00:00.000Z',
      directApply: true,
      hiringOrganization: {
        '@type': 'Organization',
        name: 'Acme Studios',
        logo: 'https://cdn.example/logo.png',
        sameAs: 'https://acme.example',
      },
      jobLocation: {
        '@type': 'Place',
        address: {
          '@type': 'PostalAddress',
          addressLocality: 'Luxembourg City',
          addressCountry: 'LU',
        },
      },
    });
  });

  it('never emits a geo property, even though the API returns a coarse lat/lng', () => {
    const jsonLd = buildJobPostingJsonLd({ offer: makeOffer() });

    expect(serializeJsonLd(jsonLd)).not.toContain('geo');
    expect(jsonLd).not.toHaveProperty('geo');
    const jobLocation = jsonLd.jobLocation as Record<string, unknown> | undefined;
    expect(jobLocation).not.toHaveProperty('geo');
  });

  it('emits only jobLocationType for a fully remote offer with no location', () => {
    const jsonLd = buildJobPostingJsonLd({ offer: makeOffer({ remote: true, location: null }) });

    expect(jsonLd.jobLocationType).toBe('TELECOMMUTE');
    expect(jsonLd).not.toHaveProperty('jobLocation');
  });

  it('emits both jobLocation and jobLocationType for a remote offer that still names a city', () => {
    const jsonLd = buildJobPostingJsonLd({
      offer: makeOffer({ remote: true, location: { lat: 49.61, lng: 6.13 } }),
    });

    expect(jsonLd.jobLocationType).toBe('TELECOMMUTE');
    expect(jsonLd.jobLocation).toEqual({
      '@type': 'Place',
      address: {
        '@type': 'PostalAddress',
        addressLocality: 'Luxembourg City',
        addressCountry: 'LU',
      },
    });
  });

  it('omits jobLocationType for a non-remote offer', () => {
    const jsonLd = buildJobPostingJsonLd({ offer: makeOffer({ remote: false }) });

    expect(jsonLd).not.toHaveProperty('jobLocationType');
  });

  it('omits baseSalary when compensation is null', () => {
    const jsonLd = buildJobPostingJsonLd({ offer: makeOffer({ compensation: null }) });

    expect(jsonLd).not.toHaveProperty('baseSalary');
  });

  it('emits baseSalary as a QuantitativeValue range when compensation is present', () => {
    const jsonLd = buildJobPostingJsonLd({
      offer: makeOffer({
        compensation: {
          min: { amountCents: 50000, currency: 'EUR' },
          max: { amountCents: 90000, currency: 'EUR' },
        },
      }),
    });

    expect(jsonLd.baseSalary).toEqual({
      '@type': 'MonetaryAmount',
      currency: 'EUR',
      value: {
        '@type': 'QuantitativeValue',
        minValue: 500,
        maxValue: 900,
      },
    });
  });

  it('never emits employmentType, which does not exist in the contract', () => {
    const jsonLd = buildJobPostingJsonLd({ offer: makeOffer() });

    expect(jsonLd).not.toHaveProperty('employmentType');
  });

  it('omits logo and sameAs when the company has neither', () => {
    const jsonLd = buildJobPostingJsonLd({
      offer: makeOffer({
        company: {
          id: '4fa85f64-5717-4562-b3fc-2c963f66afa6',
          companyName: 'Acme Studios',
          website: null,
          logoUrl: null,
          verified: false,
        },
      }),
    });

    expect(jsonLd.hiringOrganization).toEqual({ '@type': 'Organization', name: 'Acme Studios' });
  });

  it('throws if compensation is present but a leg has no price (a malformed API response)', () => {
    expect(() =>
      buildJobPostingJsonLd({
        offer: makeOffer({
          compensation: {
            min: null as unknown as { amountCents: number; currency: string },
            max: { amountCents: 90000, currency: 'EUR' },
          },
        }),
      }),
    ).toThrow(/to have a price/);
  });
});
