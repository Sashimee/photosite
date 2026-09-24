import { SlugSchema } from '@photoo/shared';
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

  // The 2-letter-segment invariant `/photographers/[slug]` relies on
  // (`lib/discovery.ts`'s own comment): a country segment and a profile
  // slug can never both match the same string, because `SlugSchema.min(3)`
  // makes a 2-letter slug impossible to create in the first place. This
  // pins that cross-module contract directly against the real schema
  // instead of trusting the comment to stay true.
  it('never accepts a string that SlugSchema could also accept', () => {
    const allLowercasePairs = Array.from({ length: 26 * 26 }, (_, index) => {
      const first = String.fromCharCode(97 + Math.floor(index / 26));
      const second = String.fromCharCode(97 + (index % 26));
      return `${first}${second}`;
    });

    for (const candidate of allLowercasePairs) {
      expect(isCountrySegment(candidate)).toBe(true);
      expect(SlugSchema.safeParse(candidate).success).toBe(false);
    }
  });

  it('never accepts a real profile slug shape (3+ chars, SlugSchema-valid)', () => {
    const realSlugs = ['abc', 'jane-doe-photography', 'sofia-martins', 'lux', 'x2y'];
    for (const slug of realSlugs) {
      expect(SlugSchema.safeParse(slug).success).toBe(true);
      expect(isCountrySegment(slug)).toBe(false);
    }
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
