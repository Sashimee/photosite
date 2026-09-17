import { describe, expect, it } from 'vitest';

import {
  hasActiveFilters,
  hasAnyFilterParam,
  parseSearchParams,
  roundCoordinate,
  serializeSearchFilters,
  toApiQuery,
} from './search-params';

describe('parseSearchParams', () => {
  it('parses every recognized field', () => {
    expect(
      parseSearchParams({
        city: ' Luxembourg City ',
        countryCode: 'LU',
        category: 'wedding',
        language: 'fr',
        priceMin: '100',
        priceMax: '500',
        cursor: 'abc123',
      }),
    ).toEqual({
      city: 'Luxembourg City',
      countryCode: 'LU',
      category: 'wedding',
      language: 'fr',
      priceMin: 100,
      priceMax: 500,
      cursor: 'abc123',
    });
  });

  it('drops an unknown category instead of failing the whole query', () => {
    expect(parseSearchParams({ category: 'landscape', city: 'Luxembourg' })).toEqual({
      city: 'Luxembourg',
    });
  });

  it('drops a malformed country or language code', () => {
    expect(parseSearchParams({ countryCode: 'Luxembourg', language: 'french' })).toEqual({});
  });

  it('drops an inverted price range entirely', () => {
    expect(parseSearchParams({ priceMin: '500', priceMax: '100' })).toEqual({});
  });

  it('keeps a lone valid price bound', () => {
    expect(parseSearchParams({ priceMin: '100' })).toEqual({ priceMin: 100 });
  });

  it('drops a negative, non-integer or non-numeric price', () => {
    expect(parseSearchParams({ priceMin: '-5' })).toEqual({});
    expect(parseSearchParams({ priceMin: '1.5' })).toEqual({});
    expect(parseSearchParams({ priceMin: 'not-a-number' })).toEqual({});
  });

  it('drops lat or lng given without its pair', () => {
    expect(parseSearchParams({ lat: '49.61' })).toEqual({});
    expect(parseSearchParams({ lng: '6.13' })).toEqual({});
  });

  it('rounds lat/lng to 2 decimals and defaults the radius', () => {
    expect(parseSearchParams({ lat: '49.611234', lng: '6.131234' })).toEqual({
      lat: 49.61,
      lng: 6.13,
      radiusKm: 25,
    });
  });

  it('keeps an explicit radiusKm within bounds', () => {
    expect(parseSearchParams({ lat: '49.61', lng: '6.13', radiusKm: '50' })).toEqual({
      lat: 49.61,
      lng: 6.13,
      radiusKm: 50,
    });
  });

  it('drops out-of-range coordinates', () => {
    expect(parseSearchParams({ lat: '200', lng: '6.13' })).toEqual({});
  });

  it('takes the first value when a param repeats', () => {
    expect(parseSearchParams({ city: ['Luxembourg', 'Esch'] })).toEqual({ city: 'Luxembourg' });
  });

  it('returns an empty object for no params', () => {
    expect(parseSearchParams({})).toEqual({});
  });
});

describe('hasAnyFilterParam', () => {
  it('is false with no query params', () => {
    expect(hasAnyFilterParam({})).toBe(false);
  });

  it('is true for any known param, even an invalid one', () => {
    expect(hasAnyFilterParam({ category: 'not-a-category' })).toBe(true);
  });

  it('ignores unrelated params', () => {
    expect(hasAnyFilterParam({ utm_source: 'newsletter' })).toBe(false);
  });
});

describe('toApiQuery', () => {
  it('converts whole-unit prices to cents and adds the page limit', () => {
    expect(toApiQuery({ priceMin: 100, priceMax: 500 })).toEqual({
      priceMinCents: 10000,
      priceMaxCents: 50000,
      limit: 20,
    });
  });

  it('passes through the other fields unchanged', () => {
    expect(
      toApiQuery({
        city: 'Luxembourg',
        countryCode: 'LU',
        category: 'wedding',
        language: 'en',
        lat: 49.61,
        lng: 6.13,
        radiusKm: 25,
        cursor: 'next-page',
      }),
    ).toEqual({
      city: 'Luxembourg',
      countryCode: 'LU',
      category: 'wedding',
      language: 'en',
      lat: 49.61,
      lng: 6.13,
      radiusKm: 25,
      cursor: 'next-page',
      limit: 20,
    });
  });

  it('returns just the page limit for an empty filter set', () => {
    expect(toApiQuery({})).toEqual({ limit: 20 });
  });
});

describe('serializeSearchFilters', () => {
  it('round-trips every field through parseSearchParams', () => {
    const filters = parseSearchParams({
      city: 'Luxembourg City',
      countryCode: 'LU',
      category: 'wedding',
      language: 'fr',
      priceMin: '100',
      lat: '49.61',
      lng: '6.13',
      radiusKm: '50',
      cursor: 'next-page',
    });
    const params = serializeSearchFilters(filters);
    expect(Object.fromEntries(params)).toEqual({
      city: 'Luxembourg City',
      countryCode: 'LU',
      category: 'wedding',
      language: 'fr',
      priceMin: '100',
      lat: '49.61',
      lng: '6.13',
      radiusKm: '50',
      cursor: 'next-page',
    });
  });

  it('produces an empty query string for an empty filter set', () => {
    expect(serializeSearchFilters({}).toString()).toBe('');
  });
});

describe('hasActiveFilters', () => {
  it('is false for an empty filter set', () => {
    expect(hasActiveFilters({})).toBe(false);
  });

  it('is true once any filter is set', () => {
    expect(hasActiveFilters({ city: 'Luxembourg' })).toBe(true);
  });
});

describe('roundCoordinate', () => {
  it('rounds to 2 decimal places', () => {
    expect(roundCoordinate(49.611789)).toBe(49.61);
    expect(roundCoordinate(-6.135999)).toBe(-6.14);
  });
});
