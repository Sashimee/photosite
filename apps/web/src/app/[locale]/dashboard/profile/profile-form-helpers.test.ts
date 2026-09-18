import { describe, expect, it } from 'vitest';

import {
  buildProfilePayload,
  defaultValuesFromProfile,
  EMPTY_PROFILE_FORM_VALUES,
  mapProfileIssuePath,
  mapValidationErrorDetailPath,
  unsupportedLanguages,
  type ProfileFormValues,
} from './profile-form-helpers';

const LOCATION = { lat: 49.61, lng: 6.13 };

function values(overrides: Partial<ProfileFormValues> = {}): ProfileFormValues {
  return {
    ...EMPTY_PROFILE_FORM_VALUES,
    displayName: 'Jane Doe',
    categories: ['wedding'],
    languages: ['en'],
    city: 'Luxembourg',
    countryCode: 'LU',
    ...overrides,
  };
}

describe('unsupportedLanguages', () => {
  it('keeps only language codes outside the 5 supported locales', () => {
    expect(unsupportedLanguages(['en', 'fr', 'ja', 'ar'])).toEqual(['ja', 'ar']);
  });

  it('returns an empty array when every language is supported', () => {
    expect(unsupportedLanguages(['en', 'fr'])).toEqual([]);
  });
});

describe('defaultValuesFromProfile', () => {
  it('returns empty values when there is no profile yet', () => {
    expect(defaultValuesFromProfile(null)).toEqual(EMPTY_PROFILE_FORM_VALUES);
  });

  it('fills every supported locale bio, defaulting missing ones to an empty string', () => {
    const defaults = defaultValuesFromProfile({
      id: 'p1',
      slug: 'jane-doe',
      displayName: 'Jane Doe',
      headline: null,
      bio: { en: 'Hello', fr: 'Bonjour' },
      avatarUrl: null,
      coverUrl: null,
      links: { other: [] },
      categories: ['wedding'],
      languages: ['en', 'ja'],
      location: LOCATION,
      serviceRadiusKm: null,
      city: 'Luxembourg',
      countryCode: 'LU',
      ratingAvg: 0,
      ratingCount: 0,
      verificationStatus: 'unverified',
      isPublished: false,
      stripeOnboardingComplete: false,
      stripePayoutsEnabled: false,
    });

    expect(defaults.bio).toEqual({ en: 'Hello', fr: 'Bonjour', de: '', pt: '', es: '' });
    // 'ja' isn't one of the 5 checkbox locales, so it drops out of the form
    // values themselves - buildProfilePayload is what carries it forward.
    expect(defaults.languages).toEqual(['en']);
  });
});

describe('buildProfilePayload', () => {
  it('trims bio text and omits locales left blank', () => {
    const payload = buildProfilePayload(
      values({ bio: { en: '  Hello  ', fr: '', de: '', pt: '', es: '' } }),
      LOCATION,
      [],
    );
    expect(payload.bio).toEqual({ en: 'Hello' });
  });

  it('sends an empty bio object when every locale is blank', () => {
    const payload = buildProfilePayload(values(), LOCATION, []);
    expect(payload.bio).toEqual({});
  });

  it('re-appends language codes the form does not offer as checkboxes', () => {
    const payload = buildProfilePayload(values({ languages: ['en'] }), LOCATION, ['ja']);
    expect(payload.languages).toEqual(['en', 'ja']);
  });

  it('carries the given location through unchanged', () => {
    const payload = buildProfilePayload(values(), LOCATION, []);
    expect(payload.location).toEqual(LOCATION);
  });
});

describe('mapProfileIssuePath', () => {
  it('maps a known top-level field', () => {
    expect(mapProfileIssuePath(['displayName'])).toBe('displayName');
    expect(mapProfileIssuePath(['categories'])).toBe('categories');
  });

  it('maps bio and location issues to null, handled outside named fields', () => {
    expect(mapProfileIssuePath(['bio', 'en'])).toBeNull();
    expect(mapProfileIssuePath(['location', 'lat'])).toBeNull();
  });

  it('maps an unknown path to null', () => {
    expect(mapProfileIssuePath(['somethingElse'])).toBeNull();
  });
});

describe('mapValidationErrorDetailPath', () => {
  it('maps dot-joined server detail paths the same way as client issues', () => {
    expect(
      mapValidationErrorDetailPath([
        { path: 'categories', message: 'Invalid' },
        { path: 'bio.en' },
      ]),
    ).toEqual(['categories', null]);
  });

  it('returns an empty array for non-array details', () => {
    expect(mapValidationErrorDetailPath(undefined)).toEqual([]);
  });
});
