import { describe, expect, it } from '@jest/globals';

import {
  hasActiveFilters,
  parseSearchFilters,
  searchFiltersToHref,
  serializeSearchFilters,
  toApiQuery,
} from './search-params';

describe('parseSearchFilters', () => {
  it('round-trips filters through router params', () => {
    const filters = parseSearchFilters({
      city: 'Luxembourg',
      category: 'wedding',
      language: 'fr',
      priceMinCents: '5000',
      priceMaxCents: '100000',
    });

    expect(filters).toEqual({
      city: 'Luxembourg',
      category: 'wedding',
      language: 'fr',
      priceMinCents: 5000,
      priceMaxCents: 100000,
    });

    const params = serializeSearchFilters(filters);
    const roundTripped = parseSearchFilters(Object.fromEntries(params.entries()));
    expect(roundTripped).toEqual(filters);
  });

  it('round-trips lat/lng/radiusKm together', () => {
    const filters = parseSearchFilters({ lat: '49.61', lng: '6.13', radiusKm: '25' });
    expect(filters).toEqual({ lat: 49.61, lng: 6.13, radiusKm: 25 });
  });

  it('drops everything when lat is given without lng', () => {
    expect(parseSearchFilters({ lat: '49.61' })).toEqual({});
  });

  it('drops everything when priceMin is greater than priceMax', () => {
    expect(parseSearchFilters({ priceMinCents: '5000', priceMaxCents: '1000' })).toEqual({});
  });

  it('ignores unknown params instead of failing', () => {
    expect(parseSearchFilters({ city: 'Metz', page: '2' })).toEqual({ city: 'Metz' });
  });

  it('takes the first value when a param repeats', () => {
    expect(parseSearchFilters({ city: ['Metz', 'Luxembourg'] })).toEqual({ city: 'Metz' });
  });

  it('returns an empty object for no params', () => {
    expect(parseSearchFilters({})).toEqual({});
  });
});

describe('hasActiveFilters', () => {
  it('is false for no filters and true otherwise', () => {
    expect(hasActiveFilters({})).toBe(false);
    expect(hasActiveFilters({ city: 'Metz' })).toBe(true);
  });
});

describe('searchFiltersToHref', () => {
  it('builds a bare path when there are no filters', () => {
    expect(searchFiltersToHref({})).toBe('/');
  });

  it('builds a query string from active filters', () => {
    expect(searchFiltersToHref({ city: 'Luxembourg', category: 'wedding' })).toBe(
      '/?city=Luxembourg&category=wedding',
    );
  });
});

describe('toApiQuery', () => {
  it('merges filters with pagination', () => {
    expect(toApiQuery({ city: 'Metz' }, { limit: 20, cursor: 'abc' })).toEqual({
      city: 'Metz',
      limit: 20,
      cursor: 'abc',
    });
  });

  it('omits filter keys that are not set instead of including them as undefined', () => {
    const query = toApiQuery({}, { limit: 20 });
    expect(query).toEqual({ limit: 20 });
    expect(Object.keys(query)).toEqual(['limit']);
  });
});
