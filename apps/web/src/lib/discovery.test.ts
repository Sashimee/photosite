import { describe, expect, it } from 'vitest';

import {
  isCountrySegment,
  isEnabledCountryCode,
  isPhotographerCategory,
  resolveCityBySlug,
} from './discovery';

describe('isCountrySegment', () => {
  it('accepts a 2-letter lowercase segment', () => {
    expect(isCountrySegment('lu')).toBe(true);
  });

  it('rejects uppercase, short and long segments', () => {
    expect(isCountrySegment('LU')).toBe(false);
    expect(isCountrySegment('l')).toBe(false);
    expect(isCountrySegment('sofia-martins')).toBe(false);
  });
});

describe('isEnabledCountryCode', () => {
  const enabledCountryCodes = ['LU'];

  it('accepts a country in the enabled list', () => {
    expect(isEnabledCountryCode('LU', enabledCountryCodes)).toBe(true);
  });

  it('rejects a country not in the enabled list', () => {
    expect(isEnabledCountryCode('FR', enabledCountryCodes)).toBe(false);
    expect(isEnabledCountryCode('lu', enabledCountryCodes)).toBe(false);
  });

  it('rejects everything when no country is enabled', () => {
    expect(isEnabledCountryCode('LU', [])).toBe(false);
  });
});

describe('isPhotographerCategory', () => {
  it('accepts known categories', () => {
    expect(isPhotographerCategory('wedding')).toBe(true);
    expect(isPhotographerCategory('real-estate')).toBe(true);
  });

  it('rejects unknown values', () => {
    expect(isPhotographerCategory('landscape')).toBe(false);
  });
});

describe('resolveCityBySlug', () => {
  const cities = [
    { slug: 'luxembourg-city', name: 'Luxembourg City', countryCode: 'LU', photographerCount: 4 },
    { slug: 'ettelbruck', name: 'Ettelbruck', countryCode: 'LU', photographerCount: 1 },
    { slug: 'ettelbruck', name: 'Ettelbrück', countryCode: 'LU', photographerCount: 3 },
  ];

  it('returns the matching city', () => {
    expect(resolveCityBySlug(cities, 'luxembourg-city')?.name).toBe('Luxembourg City');
  });

  it('picks the entry with the highest photographer count when several share a slug', () => {
    expect(resolveCityBySlug(cities, 'ettelbruck')?.name).toBe('Ettelbrück');
  });

  it('returns null when no city matches', () => {
    expect(resolveCityBySlug(cities, 'esch-sur-alzette')).toBeNull();
  });
});
