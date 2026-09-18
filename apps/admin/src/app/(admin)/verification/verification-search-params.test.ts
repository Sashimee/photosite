import { describe, expect, it } from 'vitest';

import {
  parseVerificationSearchParams,
  verificationFiltersKey,
} from './verification-search-params';

describe('parseVerificationSearchParams', () => {
  it('defaults to submitted with no status param', () => {
    expect(parseVerificationSearchParams({})).toEqual({ status: 'submitted' });
  });

  it('reads a known status and an uppercased country code', () => {
    expect(parseVerificationSearchParams({ status: 'in_review', countryCode: 'lu' })).toEqual({
      status: 'in_review',
      countryCode: 'LU',
    });
  });

  it('falls back to submitted for an unknown status', () => {
    expect(parseVerificationSearchParams({ status: 'archived' })).toEqual({
      status: 'submitted',
    });
  });

  it('drops a country code that is not two letters', () => {
    expect(parseVerificationSearchParams({ countryCode: 'LUX' })).toEqual({
      status: 'submitted',
    });
    expect(parseVerificationSearchParams({ countryCode: '1U' })).toEqual({
      status: 'submitted',
    });
  });

  it('takes the first value when a param repeats', () => {
    expect(parseVerificationSearchParams({ status: ['in_review', 'approved'] })).toEqual({
      status: 'in_review',
    });
  });
});

describe('verificationFiltersKey', () => {
  it('produces a stable key that changes when a filter changes', () => {
    const base = verificationFiltersKey({ status: 'submitted' });
    expect(verificationFiltersKey({ status: 'in_review' })).not.toBe(base);
    expect(verificationFiltersKey({ status: 'submitted', countryCode: 'LU' })).not.toBe(base);
    expect(verificationFiltersKey({ status: 'submitted' })).toBe(base);
  });
});
