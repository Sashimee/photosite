import {
  isLocale,
  SUPPORTED_LOCALES,
  type Locale,
  type PhotographerCategory,
} from '@photoo/shared';
import type { components } from '@photoo/api-client';

import type { PickedLocation } from '../../requests/new/location-picker';

type OwnPhotographerProfile = components['schemas']['OwnPhotographerProfile'];

export interface ProfileFormValues {
  displayName: string;
  categories: PhotographerCategory[];
  languages: Locale[];
  city: string;
  countryCode: string;
  bio: Record<Locale, string>;
}

export const EMPTY_PROFILE_FORM_VALUES: ProfileFormValues = {
  displayName: '',
  categories: [],
  languages: [],
  city: '',
  countryCode: '',
  bio: Object.fromEntries(SUPPORTED_LOCALES.map((locale) => [locale, ''])) as Record<
    Locale,
    string
  >,
};

// Any language code a profile already carries that falls outside the 5
// locales this form offers as checkboxes (packages/i18n's SUPPORTED_LOCALES)
// is preserved rather than silently dropped on the next save - the schema's
// `LanguageCodeSchema` accepts any ISO 639-1 code, this form just doesn't
// offer every one of them yet.
export function unsupportedLanguages(languages: readonly string[]): string[] {
  return languages.filter((language) => !isLocale(language));
}

export function defaultValuesFromProfile(
  profile: OwnPhotographerProfile | null,
): ProfileFormValues {
  if (!profile) {
    return EMPTY_PROFILE_FORM_VALUES;
  }
  return {
    displayName: profile.displayName,
    categories: [...profile.categories],
    languages: profile.languages.filter(isLocale),
    city: profile.city,
    countryCode: profile.countryCode,
    bio: Object.fromEntries(
      SUPPORTED_LOCALES.map((locale) => [locale, profile.bio[locale] ?? '']),
    ) as Record<Locale, string>,
  };
}

function buildBio(bio: Record<Locale, string>): Partial<Record<Locale, string>> {
  const result: Partial<Record<Locale, string>> = {};
  for (const locale of SUPPORTED_LOCALES) {
    const trimmed = bio[locale].trim();
    if (trimmed) {
      result[locale] = trimmed;
    }
  }
  return result;
}

// `location` is required, not `PickedLocation | null`: callers only build a
// payload once the location picker's own required check has passed. A
// nullable parameter here would give this return type a `location: X |
// undefined`, which `exactOptionalPropertyTypes` rejects against the API's
// required `location` field when this object is sent as the request body.
export function buildProfilePayload(
  values: ProfileFormValues,
  location: PickedLocation,
  keptUnsupportedLanguages: readonly string[],
) {
  return {
    displayName: values.displayName,
    categories: values.categories,
    languages: [...values.languages, ...keptUnsupportedLanguages],
    city: values.city,
    countryCode: values.countryCode,
    location,
    bio: buildBio(values.bio),
  };
}

// `bio.*` and `location` issues surface through the bio note and the
// location picker's own required-field message, not a named form field, so
// they map to `null` here on purpose - same convention as the request form's
// `mapCreateRequestIssuePath`.
export function mapProfileIssuePath(path: readonly PropertyKey[]): keyof ProfileFormValues | null {
  const [first] = path;
  if (first === 'bio' || first === 'location') {
    return null;
  }
  return typeof first === 'string' && first in EMPTY_PROFILE_FORM_VALUES
    ? (first as keyof ProfileFormValues)
    : null;
}

interface ValidationErrorDetail {
  path?: string;
  message?: string;
}

function isValidationErrorDetail(value: unknown): value is ValidationErrorDetail {
  return typeof value === 'object' && value !== null;
}

// The API's 400 VALIDATION_ERROR carries `details: [{ path: "categories", ... }]`,
// a dot-joined string rather than the segment array zod itself uses.
export function mapValidationErrorDetailPath(details: unknown): (keyof ProfileFormValues | null)[] {
  if (!Array.isArray(details)) {
    return [];
  }
  return details.map((detail) => {
    if (!isValidationErrorDetail(detail) || typeof detail.path !== 'string') {
      return null;
    }
    return mapProfileIssuePath(detail.path.split('.'));
  });
}
