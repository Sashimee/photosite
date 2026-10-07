import type { components } from '@photoo/api-client';
import {
  SUPPORTED_LOCALES,
  isLocale,
  type Locale,
  type PhotographerCategory,
} from '@photoo/shared';

import type { Coordinates } from './location';

type OwnPhotographerProfile = components['schemas']['OwnPhotographerProfile'];

export interface StudioProfileValues {
  displayName: string;
  categories: PhotographerCategory[];
  languages: Locale[];
  city: string;
  countryCode: string;
  bio: Record<Locale, string>;
}

export type StudioProfileField = Exclude<keyof StudioProfileValues, 'bio'>;

export type StudioProfileErrors = Partial<Record<StudioProfileField, string>>;

const FIELDS: readonly StudioProfileField[] = [
  'displayName',
  'categories',
  'languages',
  'city',
  'countryCode',
];

function emptyBio(): Record<Locale, string> {
  return Object.fromEntries(SUPPORTED_LOCALES.map((locale) => [locale, ''])) as Record<
    Locale,
    string
  >;
}

export function emptyStudioProfileValues(): StudioProfileValues {
  return {
    displayName: '',
    categories: [],
    languages: [],
    city: '',
    countryCode: '',
    bio: emptyBio(),
  };
}

export function valuesFromProfile(profile: OwnPhotographerProfile | null): StudioProfileValues {
  if (!profile) {
    return emptyStudioProfileValues();
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

// The profile may carry language codes outside the locales the form offers;
// they are re-sent on save so editing never silently drops them.
export function unsupportedLanguages(languages: readonly string[]): string[] {
  return languages.filter((language) => !isLocale(language));
}

export function toggleValue<T>(values: readonly T[], value: T): T[] {
  return values.includes(value) ? values.filter((entry) => entry !== value) : [...values, value];
}

export function buildProfilePayload(
  values: StudioProfileValues,
  location: Coordinates,
  keptUnsupportedLanguages: readonly string[],
) {
  const bio: Partial<Record<Locale, string>> = {};
  for (const locale of SUPPORTED_LOCALES) {
    const trimmed = values.bio[locale].trim();
    if (trimmed) {
      bio[locale] = trimmed;
    }
  }
  return {
    displayName: values.displayName.trim(),
    categories: values.categories,
    languages: [...values.languages, ...keptUnsupportedLanguages],
    city: values.city.trim(),
    countryCode: values.countryCode,
    location,
    bio,
  };
}

export function mapProfileIssuePath(path: readonly PropertyKey[]): StudioProfileField | null {
  const [first] = path;
  return FIELDS.find((field) => field === first) ?? null;
}

export function mapServerFieldErrors(details: unknown): StudioProfileField[] {
  if (!Array.isArray(details)) {
    return [];
  }
  return details.flatMap((detail: unknown) => {
    if (typeof detail !== 'object' || detail === null || !('path' in detail)) {
      return [];
    }
    const { path } = detail;
    const field = typeof path === 'string' ? mapProfileIssuePath(path.split('.')) : null;
    return field ? [field] : [];
  });
}
