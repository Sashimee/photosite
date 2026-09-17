import { PHOTOGRAPHER_CATEGORIES, type PhotographerCategory } from '@photoo/shared';

export function isEnabledCountryCode(
  value: string,
  enabledCountryCodes: readonly string[],
): boolean {
  return enabledCountryCodes.includes(value);
}

const COUNTRY_SEGMENT_PATTERN = /^[a-z]{2}$/;

// Profile slugs are at least 3 characters (`SlugSchema`), so a 2-letter
// lowercase `[slug]` segment can only ever be a country landing page.
export function isCountrySegment(slug: string): boolean {
  return COUNTRY_SEGMENT_PATTERN.test(slug);
}

export function isPhotographerCategory(value: string): value is PhotographerCategory {
  return (PHOTOGRAPHER_CATEGORIES as readonly string[]).includes(value);
}

export interface CitySummaryLike {
  slug: string;
  name: string;
  countryCode: string;
  photographerCount: number;
}

// `/v1/cities` slugifies city names in TypeScript rather than storing a
// slug, so two differently-accented spellings of the same place ("Ettelbrück"
// vs "Ettelbruck") can collide on one slug; the busier entry wins.
export function resolveCityBySlug<T extends CitySummaryLike>(
  cities: readonly T[],
  citySlug: string,
): T | null {
  const matches = cities.filter((city) => city.slug === citySlug);
  if (matches.length === 0) {
    return null;
  }
  return matches.reduce((best, city) =>
    city.photographerCount > best.photographerCount ? city : best,
  );
}
