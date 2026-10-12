import { describe, expect, it } from '@jest/globals';

import {
  buildProfilePayload,
  emptyStudioProfileValues,
  mapProfileIssuePath,
  mapServerFieldErrors,
  toggleValue,
  unsupportedLanguages,
  valuesFromProfile,
} from './studio-profile-form';

describe('studio profile form helpers', () => {
  it('toggles a value in and out of a selection', () => {
    expect(toggleValue(['a'], 'b')).toEqual(['a', 'b']);
    expect(toggleValue(['a', 'b'], 'a')).toEqual(['b']);
  });

  it('builds a payload that trims, drops blank bios and re-sends unsupported languages', () => {
    const values = {
      ...emptyStudioProfileValues(),
      displayName: '  Jane  ',
      categories: ['wedding' as const],
      languages: ['en' as const],
      city: ' Luxembourg ',
      countryCode: 'LU',
      bio: { ...emptyStudioProfileValues().bio, en: ' Hello ', fr: '   ' },
    };

    expect(buildProfilePayload(values, { lat: 49.61, lng: 6.13 }, ['it'])).toEqual({
      displayName: 'Jane',
      categories: ['wedding'],
      languages: ['en', 'it'],
      city: 'Luxembourg',
      countryCode: 'LU',
      location: { lat: 49.61, lng: 6.13 },
      bio: { en: 'Hello' },
    });
  });

  it('keeps language codes outside the offered locales', () => {
    expect(unsupportedLanguages(['en', 'it', 'nl'])).toEqual(['it', 'nl']);
  });

  it('maps a missing profile to empty values', () => {
    expect(valuesFromProfile(null)).toEqual(emptyStudioProfileValues());
  });

  it('maps issue paths to form fields, ignoring bio and location', () => {
    expect(mapProfileIssuePath(['categories', 0])).toBe('categories');
    expect(mapProfileIssuePath(['bio', 'en'])).toBeNull();
    expect(mapProfileIssuePath(['location'])).toBeNull();
  });

  it('maps server validation details to fields', () => {
    expect(
      mapServerFieldErrors([{ path: 'displayName' }, { path: 'bio.en' }, 'x', { path: 7 }]),
    ).toEqual(['displayName']);
    expect(mapServerFieldErrors(undefined)).toEqual([]);
  });
});
