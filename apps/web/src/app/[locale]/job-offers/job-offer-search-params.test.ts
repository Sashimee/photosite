import { describe, expect, it } from 'vitest';

import {
  hasActiveFilters,
  hasAnyFilterParam,
  parseJobOfferSearchParams,
  serializeJobOfferFilters,
  toJobOfferApiQuery,
} from './job-offer-search-params';

describe('parseJobOfferSearchParams', () => {
  it('parses every known filter', () => {
    const filters = parseJobOfferSearchParams({
      category: 'wedding',
      countryCode: 'LU',
      city: 'Luxembourg City',
      remote: 'true',
      q: 'second shooter',
      cursor: 'abc',
    });

    expect(filters).toEqual({
      category: 'wedding',
      countryCode: 'LU',
      city: 'Luxembourg City',
      remote: true,
      q: 'second shooter',
      cursor: 'abc',
    });
  });

  it('drops an invalid category instead of throwing', () => {
    expect(parseJobOfferSearchParams({ category: 'not-a-category' })).toEqual({});
  });

  it('drops an invalid country code instead of throwing', () => {
    expect(parseJobOfferSearchParams({ countryCode: 'LUXEMBOURG' })).toEqual({});
  });

  it('drops a remote value that is not the literal string "true"', () => {
    expect(parseJobOfferSearchParams({ remote: 'false' })).toEqual({});
    expect(parseJobOfferSearchParams({ remote: 'yes' })).toEqual({});
  });

  it('trims city and q and drops them once empty', () => {
    expect(parseJobOfferSearchParams({ city: '   ', q: '   ' })).toEqual({});
    expect(parseJobOfferSearchParams({ city: '  Luxembourg  ' })).toEqual({ city: 'Luxembourg' });
  });

  it('returns an empty object for no params', () => {
    expect(parseJobOfferSearchParams({})).toEqual({});
  });
});

describe('hasAnyFilterParam', () => {
  it('is true once any known key is present, even with an invalid value', () => {
    expect(hasAnyFilterParam({ category: 'not-a-category' })).toBe(true);
    expect(hasAnyFilterParam({ cursor: 'abc' })).toBe(true);
  });

  it('is false with no known keys', () => {
    expect(hasAnyFilterParam({ unrelated: 'x' })).toBe(false);
    expect(hasAnyFilterParam({})).toBe(false);
  });
});

describe('hasActiveFilters', () => {
  it('is false for an empty filter set and true otherwise', () => {
    expect(hasActiveFilters({})).toBe(false);
    expect(hasActiveFilters({ remote: true })).toBe(true);
  });
});

describe('toJobOfferApiQuery', () => {
  it('converts remote to a string and always includes the page limit', () => {
    expect(toJobOfferApiQuery({ remote: true })).toEqual({ remote: 'true', limit: 20 });
    expect(toJobOfferApiQuery({})).toEqual({ limit: 20 });
  });
});

describe('serializeJobOfferFilters', () => {
  it('round-trips every filter into query params', () => {
    const params = serializeJobOfferFilters({
      category: 'wedding',
      countryCode: 'LU',
      city: 'Luxembourg City',
      remote: true,
      q: 'second shooter',
      cursor: 'abc',
    });

    expect(params.toString()).toBe(
      'category=wedding&countryCode=LU&city=Luxembourg+City&remote=true&q=second+shooter&cursor=abc',
    );
  });
});
