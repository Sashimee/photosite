import { CreateRequestRequestSchema } from '@photoo/shared';
import { describe, expect, it } from 'vitest';

import {
  buildCreateRequestPayload,
  EMPTY_REQUEST_FORM_VALUES,
  mapCreateRequestIssuePath,
  mapValidationErrorDetailPath,
  type RequestFormValues,
} from './request-form-helpers';

const futureEventDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 16);

const validValues: RequestFormValues = {
  ...EMPTY_REQUEST_FORM_VALUES,
  title: 'Wedding photographer needed',
  category: 'wedding',
  description: 'Looking for a wedding photographer for a full day',
  eventDate: futureEventDate,
  addressLine1: '10 rue de la Gare',
  addressCity: 'Luxembourg',
  addressPostalCode: 'L-1611',
  addressCountryCode: 'LU',
  budgetMin: '1000',
  budgetMax: '2000',
  usage: 'personal',
};

const validLocation = { lat: 49.6116, lng: 6.1319 };

describe('buildCreateRequestPayload', () => {
  it('converts whole-unit budgets to cents', () => {
    const payload = buildCreateRequestPayload(validValues, validLocation, 'EUR');
    expect(payload.budgetMin).toEqual({ amountCents: 100000, currency: 'EUR' });
    expect(payload.budgetMax).toEqual({ amountCents: 200000, currency: 'EUR' });
  });

  it('rounds fractional whole-unit budgets to the nearest cent', () => {
    const payload = buildCreateRequestPayload(
      { ...validValues, budgetMin: '10.005', budgetMax: '20.004' },
      validLocation,
      'EUR',
    );
    expect(payload.budgetMin.amountCents).toBe(1001);
    expect(payload.budgetMax.amountCents).toBe(2000);
  });

  it('produces a payload that CreateRequestRequestSchema accepts', () => {
    const payload = buildCreateRequestPayload(validValues, validLocation, 'EUR');
    expect(CreateRequestRequestSchema.safeParse(payload).success).toBe(true);
  });

  it('omits an empty address line 2', () => {
    const payload = buildCreateRequestPayload(validValues, validLocation, 'EUR');
    expect(payload.address).not.toHaveProperty('line2');
  });

  it('includes a non-empty address line 2', () => {
    const payload = buildCreateRequestPayload(
      { ...validValues, addressLine2: 'Floor 2' },
      validLocation,
      'EUR',
    );
    expect(payload.address.line2).toBe('Floor 2');
  });

  it('fails validation with no location', () => {
    const payload = buildCreateRequestPayload(validValues, null, 'EUR');
    expect(CreateRequestRequestSchema.safeParse(payload).success).toBe(false);
  });

  it('fails validation with an empty budget instead of silently sending 0', () => {
    const payload = buildCreateRequestPayload(
      { ...validValues, budgetMin: '' },
      validLocation,
      'EUR',
    );
    expect(Number.isNaN(payload.budgetMin.amountCents)).toBe(true);
    expect(CreateRequestRequestSchema.safeParse(payload).success).toBe(false);
  });

  it('fails validation with a non-numeric budget', () => {
    const payload = buildCreateRequestPayload(
      { ...validValues, budgetMax: 'lots' },
      validLocation,
      'EUR',
    );
    expect(CreateRequestRequestSchema.safeParse(payload).success).toBe(false);
  });

  it('fails validation with an empty or unparsable event date instead of throwing', () => {
    expect(() =>
      buildCreateRequestPayload({ ...validValues, eventDate: '' }, validLocation, 'EUR'),
    ).not.toThrow();
    const payload = buildCreateRequestPayload(
      { ...validValues, eventDate: '' },
      validLocation,
      'EUR',
    );
    expect(CreateRequestRequestSchema.safeParse(payload).success).toBe(false);
  });
});

describe('mapCreateRequestIssuePath', () => {
  it('maps address sub-paths to their flat form field names', () => {
    expect(mapCreateRequestIssuePath(['address', 'line1'])).toBe('addressLine1');
    expect(mapCreateRequestIssuePath(['address', 'city'])).toBe('addressCity');
    expect(mapCreateRequestIssuePath(['address', 'postalCode'])).toBe('addressPostalCode');
    expect(mapCreateRequestIssuePath(['address', 'countryCode'])).toBe('addressCountryCode');
  });

  it('maps top-level fields to themselves', () => {
    expect(mapCreateRequestIssuePath(['title'])).toBe('title');
    expect(mapCreateRequestIssuePath(['budgetMax'])).toBe('budgetMax');
    expect(mapCreateRequestIssuePath(['usage'])).toBe('usage');
  });

  it('maps location issues to null so the picker owns that message', () => {
    expect(mapCreateRequestIssuePath(['location'])).toBeNull();
    expect(mapCreateRequestIssuePath(['location', 'lat'])).toBeNull();
  });

  it('returns null for unknown paths', () => {
    expect(mapCreateRequestIssuePath(['unknownField'])).toBeNull();
    expect(mapCreateRequestIssuePath([])).toBeNull();
  });
});

describe('mapValidationErrorDetailPath', () => {
  it('maps each dot-joined detail path to its form field', () => {
    expect(
      mapValidationErrorDetailPath([
        { path: 'address.postalCode', message: 'Invalid input' },
        { path: 'title', message: 'Invalid input' },
      ]),
    ).toEqual(['addressPostalCode', 'title']);
  });

  it('maps an unmappable or malformed detail to null instead of throwing', () => {
    expect(
      mapValidationErrorDetailPath([{ path: 'location' }, { message: 'no path' }, {}]),
    ).toEqual([null, null, null]);
  });

  it('returns an empty array for non-array input', () => {
    expect(mapValidationErrorDetailPath(undefined)).toEqual([]);
    expect(mapValidationErrorDetailPath(null)).toEqual([]);
    expect(mapValidationErrorDetailPath('not an array')).toEqual([]);
  });
});
