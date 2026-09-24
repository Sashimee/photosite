import { describe, expect, it } from 'vitest';

import {
  buildJobOfferPayload,
  defaultValuesFromJobOffer,
  EMPTY_JOB_OFFER_FORM_VALUES,
  isJobOfferLocationMissing,
  isValidJobOfferDateRange,
  locationFromJobOffer,
  mapJobOfferIssuePath,
  mapValidationErrorDetailPath,
  type JobOfferInput,
} from './job-offer-form-helpers';

const EXISTING_OFFER: JobOfferInput = {
  id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  slug: 'wedding-photographer-needed',
  title: 'Wedding photographer needed',
  description: 'Full day coverage for a wedding in June.',
  category: 'wedding',
  city: 'Luxembourg',
  countryCode: 'LU',
  location: { lat: 49.61, lng: 6.13 },
  remote: false,
  startDate: '2026-06-01T00:00:00.000Z',
  endDate: '2026-06-02T00:00:00.000Z',
  compensation: {
    min: { amountCents: 50000, currency: 'EUR' },
    max: { amountCents: 100000, currency: 'EUR' },
  },
  status: 'draft',
  publishedAt: null,
  expiresAt: null,
};

describe('defaultValuesFromJobOffer', () => {
  it('returns empty values with no offer', () => {
    expect(defaultValuesFromJobOffer(null)).toEqual(EMPTY_JOB_OFFER_FORM_VALUES);
  });

  it('converts an existing offer, including cents to whole units', () => {
    expect(defaultValuesFromJobOffer(EXISTING_OFFER)).toEqual({
      title: 'Wedding photographer needed',
      description: 'Full day coverage for a wedding in June.',
      category: 'wedding',
      city: 'Luxembourg',
      countryCode: 'LU',
      remote: false,
      startDate: '2026-06-01',
      endDate: '2026-06-02',
      compensationMin: '500',
      compensationMax: '1000',
    });
  });

  it('leaves compensation fields empty when the offer has none', () => {
    const values = defaultValuesFromJobOffer({ ...EXISTING_OFFER, compensation: null });
    expect(values.compensationMin).toBe('');
    expect(values.compensationMax).toBe('');
  });

  it('throws loudly if a present compensation carries a null Money leg', () => {
    expect(() =>
      defaultValuesFromJobOffer({
        ...EXISTING_OFFER,
        compensation: { min: null, max: { amountCents: 100000, currency: 'EUR' } },
      }),
    ).toThrow(/compensation min/);
  });
});

describe('locationFromJobOffer', () => {
  it('returns null with no offer', () => {
    expect(locationFromJobOffer(null)).toBeNull();
  });

  it('returns the offer location', () => {
    expect(locationFromJobOffer(EXISTING_OFFER)).toEqual({ lat: 49.61, lng: 6.13 });
  });

  it('returns null for a remote offer with no location', () => {
    expect(locationFromJobOffer({ ...EXISTING_OFFER, remote: true, location: null })).toBeNull();
  });
});

describe('isValidJobOfferDateRange', () => {
  it('is valid when either date is missing', () => {
    expect(isValidJobOfferDateRange('', '2026-06-01')).toBe(true);
    expect(isValidJobOfferDateRange('2026-06-01', '')).toBe(true);
    expect(isValidJobOfferDateRange('', '')).toBe(true);
  });

  it('is valid when start is before or equal to end', () => {
    expect(isValidJobOfferDateRange('2026-06-01', '2026-06-02')).toBe(true);
    expect(isValidJobOfferDateRange('2026-06-01', '2026-06-01')).toBe(true);
  });

  it('is invalid when start is after end', () => {
    expect(isValidJobOfferDateRange('2026-06-02', '2026-06-01')).toBe(false);
  });
});

describe('isJobOfferLocationMissing', () => {
  it('is never missing for a remote offer', () => {
    expect(isJobOfferLocationMissing(true, null)).toBe(false);
  });

  it('is missing for a non-remote offer with no location', () => {
    expect(isJobOfferLocationMissing(false, null)).toBe(true);
  });

  it('is not missing for a non-remote offer with a location', () => {
    expect(isJobOfferLocationMissing(false, { lat: 49.61, lng: 6.13 })).toBe(false);
  });
});

describe('buildJobOfferPayload', () => {
  const values = {
    ...EMPTY_JOB_OFFER_FORM_VALUES,
    title: '  Wedding photographer needed  ',
    description: '  Full day coverage  ',
    category: 'wedding' as const,
    city: '  Luxembourg  ',
    countryCode: 'LU',
  };

  it('trims text fields and omits location when there is none', () => {
    const payload = buildJobOfferPayload(values, null, 'EUR');
    expect(payload.title).toBe('Wedding photographer needed');
    expect(payload.description).toBe('Full day coverage');
    expect(payload.city).toBe('Luxembourg');
    expect('location' in payload).toBe(false);
    expect(payload.compensation).toBeNull();
    expect(payload.startDate).toBeNull();
    expect(payload.endDate).toBeNull();
  });

  it('includes location when given one', () => {
    const payload = buildJobOfferPayload(values, { lat: 49.61, lng: 6.13 }, 'EUR');
    expect(payload.location).toEqual({ lat: 49.61, lng: 6.13 });
  });

  it('converts compensation to cents in the given currency', () => {
    const payload = buildJobOfferPayload(
      { ...values, compensationMin: '500', compensationMax: '1000' },
      null,
      'EUR',
    );
    expect(payload.compensation).toEqual({
      min: { amountCents: 50000, currency: 'EUR' },
      max: { amountCents: 100000, currency: 'EUR' },
    });
  });

  it('converts date-only inputs to ISO date-times', () => {
    const payload = buildJobOfferPayload(
      { ...values, startDate: '2026-06-01', endDate: '2026-06-02' },
      null,
      'EUR',
    );
    expect(payload.startDate).toBe(new Date('2026-06-01').toISOString());
    expect(payload.endDate).toBe(new Date('2026-06-02').toISOString());
  });
});

describe('mapJobOfferIssuePath', () => {
  it('maps top-level fields', () => {
    expect(mapJobOfferIssuePath(['title'])).toBe('title');
    expect(mapJobOfferIssuePath(['city'])).toBe('city');
  });

  it('maps compensation sub-fields', () => {
    expect(mapJobOfferIssuePath(['compensation', 'min'])).toBe('compensationMin');
    expect(mapJobOfferIssuePath(['compensation', 'min', 'amountCents'])).toBe('compensationMin');
    expect(mapJobOfferIssuePath(['compensation', 'max'])).toBe('compensationMax');
  });

  it('maps location issues to null, surfaced through the picker instead', () => {
    expect(mapJobOfferIssuePath(['location'])).toBeNull();
  });

  it('maps unknown paths to null', () => {
    expect(mapJobOfferIssuePath(['somethingElse'])).toBeNull();
    expect(mapJobOfferIssuePath(['compensation', 'somethingElse'])).toBeNull();
  });
});

describe('mapValidationErrorDetailPath', () => {
  it('maps a list of dot-joined paths', () => {
    expect(
      mapValidationErrorDetailPath([
        { path: 'title', message: 'required' },
        { path: 'compensation.min.amountCents', message: 'invalid' },
        { path: 'location', message: 'required' },
      ]),
    ).toEqual(['title', 'compensationMin', null]);
  });

  it('returns an empty array for non-array details', () => {
    expect(mapValidationErrorDetailPath(undefined)).toEqual([]);
    expect(mapValidationErrorDetailPath('nope')).toEqual([]);
  });
});
