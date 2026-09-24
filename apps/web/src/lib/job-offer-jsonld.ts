import type { components } from '@photoo/api-client';

import { requireMoney } from './money';

// Same `JobOfferInput` fix as account/job-offers/job-offer-form-helpers.ts:
// `location`'s generated type intersects `LatLng` with `Record<string,
// never> | null`, which a plain `{ lat, lng }` object never structurally
// satisfies.
export type PublicJobOffer = Omit<components['schemas']['PublicJobOffer'], 'location'> & {
  location: { lat: number; lng: number } | null;
};
type PublicProfessionalCompany = components['schemas']['PublicProfessionalCompany'];
type Compensation = NonNullable<components['schemas']['PublicJobOffer']['compensation']>;

export interface JobPostingJsonLdInput {
  offer: PublicJobOffer;
}

function buildHiringOrganization(company: PublicProfessionalCompany): Record<string, unknown> {
  return {
    '@type': 'Organization',
    name: company.companyName,
    ...(company.logoUrl ? { logo: company.logoUrl } : {}),
    ...(company.website ? { sameAs: company.website } : {}),
  };
}

// `addressLocality`/`addressCountry` only - no `geo` (`GeoCoordinates`) is
// ever emitted, even though the API returns a coarse lat/lng. A city-level
// address is honest about what we know; a coordinate, even grid-snapped,
// reads to a JobPosting consumer as a precise pin
// (docs/steps/1B.9-professional-area.md).
function buildJobLocation(offer: PublicJobOffer): Record<string, unknown> {
  return {
    '@type': 'Place',
    address: {
      '@type': 'PostalAddress',
      addressLocality: offer.city,
      addressCountry: offer.countryCode,
    },
  };
}

function buildBaseSalary(compensation: Compensation): Record<string, unknown> {
  const min = requireMoney(compensation.min, 'job offer compensation min');
  const max = requireMoney(compensation.max, 'job offer compensation max');
  return {
    '@type': 'MonetaryAmount',
    currency: min.currency,
    value: {
      '@type': 'QuantitativeValue',
      minValue: min.amountCents / 100,
      maxValue: max.amountCents / 100,
    },
  };
}

// `location` is the coarse LatLng, null exactly when a remote offer has no
// site at all - that case gets `jobLocationType: 'TELECOMMUTE'` and no
// `jobLocation` (there is no honest place to describe). A remote offer that
// still names a city gets both; a non-remote offer always has a location
// per the create schema's refinement, so it gets `jobLocation` alone.
export function buildJobPostingJsonLd({ offer }: JobPostingJsonLdInput): Record<string, unknown> {
  const hasLocation = offer.location !== null;

  return {
    '@context': 'https://schema.org',
    '@type': 'JobPosting',
    title: offer.title,
    description: offer.description,
    datePosted: offer.publishedAt,
    validThrough: offer.expiresAt,
    directApply: true,
    hiringOrganization: buildHiringOrganization(offer.company),
    ...(hasLocation ? { jobLocation: buildJobLocation(offer) } : {}),
    ...(offer.remote ? { jobLocationType: 'TELECOMMUTE' } : {}),
    ...(offer.compensation ? { baseSalary: buildBaseSalary(offer.compensation) } : {}),
  };
}
