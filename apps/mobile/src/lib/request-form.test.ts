import { describe, expect, it } from '@jest/globals';

import { CreateRequestRequestSchema } from '@photoo/shared';

import {
  EMPTY_REQUEST_FORM_VALUES,
  buildCreateRequestPayload,
  mapRequestIssues,
  mapServerFieldErrors,
  type RequestFormValues,
} from './request-form';

const validValues: RequestFormValues = {
  ...EMPTY_REQUEST_FORM_VALUES,
  title: 'Wedding',
  category: 'wedding',
  description: 'Two hundred guests',
  eventDate: new Date(Date.now() + 86_400_000),
  addressLine1: '1 Rue Test',
  addressCity: 'Luxembourg',
  addressPostalCode: 'L-1111',
  addressCountryCode: 'LU',
  budgetMin: '500',
  budgetMax: '900',
  usage: 'personal',
};

const messages = {
  validation: (key: string) => `validation:${key}`,
  budgetOrder: 'budget-order',
  eventDateInPast: 'past',
};

function issuesFor(values: RequestFormValues, location: { lat: number; lng: number } | null) {
  const result = CreateRequestRequestSchema.safeParse(
    buildCreateRequestPayload(values, location, 'EUR'),
  );
  if (result.success) {
    throw new Error('expected validation to fail');
  }
  return mapRequestIssues(result.error, messages);
}

describe('buildCreateRequestPayload', () => {
  it('converts whole-unit budgets to cents in the Country currency and snaps the location', () => {
    const payload = buildCreateRequestPayload(validValues, { lat: 49.6116, lng: 6.1319 }, 'EUR');

    expect(payload.budgetMin).toEqual({ amountCents: 50000, currency: 'EUR' });
    expect(payload.budgetMax).toEqual({ amountCents: 90000, currency: 'EUR' });
    expect(payload.location).toEqual({ lat: 49.61, lng: 6.13 });
    expect(CreateRequestRequestSchema.safeParse(payload).success).toBe(true);
  });

  it('omits an empty address line 2', () => {
    const { address } = buildCreateRequestPayload(
      { ...validValues, addressLine2: '  ' },
      { lat: 1, lng: 1 },
      'EUR',
    );
    expect('line2' in address).toBe(false);
  });
});

describe('request validation', () => {
  it('flags every empty required field', () => {
    const { fields, locationInvalid } = issuesFor(EMPTY_REQUEST_FORM_VALUES, null);

    expect(Object.keys(fields).sort()).toEqual(
      [
        'addressCity',
        'addressCountryCode',
        'addressLine1',
        'addressPostalCode',
        'budgetMax',
        'budgetMin',
        'category',
        'description',
        'eventDate',
        'title',
        'usage',
      ].sort(),
    );
    expect(locationInvalid).toBe(true);
  });

  it('rejects fractional budgets as a field error rather than sending a rounded value', () => {
    const { fields } = issuesFor({ ...validValues, budgetMin: '1.5' }, { lat: 1, lng: 1 });
    expect(fields.budgetMin).toBe('validation:required');
  });

  it('puts a minimum above the maximum on the maximum field', () => {
    const { fields } = issuesFor(
      { ...validValues, budgetMin: '900', budgetMax: '500' },
      { lat: 1, lng: 1 },
    );
    expect(fields).toEqual({ budgetMax: 'budget-order' });
  });

  it('rejects an event date in the past', () => {
    const { fields } = issuesFor(
      { ...validValues, eventDate: new Date(Date.now() - 60_000) },
      { lat: 1, lng: 1 },
    );
    expect(fields).toEqual({ eventDate: 'past' });
  });

  it('requires a location even when the address is complete', () => {
    const { fields, locationInvalid } = issuesFor(validValues, null);
    expect(fields).toEqual({});
    expect(locationInvalid).toBe(true);
  });
});

describe('mapServerFieldErrors', () => {
  it('maps dot-joined server paths onto form fields and ignores unknown ones', () => {
    expect(
      mapServerFieldErrors([
        { path: 'address.postalCode' },
        { path: 'budgetMax' },
        { path: 'location.lat' },
        { path: 'nonsense' },
        'bad',
      ]),
    ).toEqual(['addressPostalCode', 'budgetMax']);
  });

  it('returns nothing for non-array details', () => {
    expect(mapServerFieldErrors(undefined)).toEqual([]);
  });
});
