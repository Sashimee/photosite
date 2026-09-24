import {
  CountryCodeSchema,
  PHOTOGRAPHER_CATEGORIES,
  type PhotographerCategory,
} from '@photoo/shared';

export const JOB_OFFERS_RESULTS_LIMIT = 20;
const CITY_MAX_LENGTH = 120;
const QUERY_MAX_LENGTH = 150;

export type RawSearchParams = Record<string, string | string[] | undefined>;

export interface JobOfferFilters {
  category?: PhotographerCategory;
  countryCode?: string;
  city?: string;
  remote?: boolean;
  q?: string;
  cursor?: string;
}

export interface JobOfferApiQuery {
  category?: PhotographerCategory;
  countryCode?: string;
  city?: string;
  remote?: string;
  q?: string;
  cursor?: string;
  limit: number;
}

const KNOWN_FILTER_KEYS = ['category', 'countryCode', 'city', 'remote', 'q', 'cursor'] as const;

function firstValue(raw: RawSearchParams, key: string): string | undefined {
  const value = raw[key];
  return Array.isArray(value) ? value[0] : value;
}

// Every field is dropped independently instead of validating the whole
// object against `JobOffersQuerySchema`, the same reasoning as the
// photographer search's `parseSearchParams` (lib/search-params.ts): a bad
// value on one field must never 400 a visitor or a crawler.
export function parseJobOfferSearchParams(raw: RawSearchParams): JobOfferFilters {
  const filters: JobOfferFilters = {};

  const category = firstValue(raw, 'category');
  if (category && (PHOTOGRAPHER_CATEGORIES as readonly string[]).includes(category)) {
    filters.category = category as PhotographerCategory;
  }

  const countryCode = firstValue(raw, 'countryCode');
  if (countryCode && CountryCodeSchema.safeParse(countryCode).success) {
    filters.countryCode = countryCode;
  }

  const city = firstValue(raw, 'city')?.trim();
  if (city && city.length > 0 && city.length <= CITY_MAX_LENGTH) {
    filters.city = city;
  }

  const remote = firstValue(raw, 'remote');
  if (remote === 'true') {
    filters.remote = true;
  }

  const q = firstValue(raw, 'q')?.trim();
  if (q && q.length > 0 && q.length <= QUERY_MAX_LENGTH) {
    filters.q = q;
  }

  const cursor = firstValue(raw, 'cursor')?.trim();
  if (cursor) {
    filters.cursor = cursor;
  }

  return filters;
}

export function hasAnyFilterParam(raw: RawSearchParams): boolean {
  return KNOWN_FILTER_KEYS.some((key) => firstValue(raw, key) !== undefined);
}

export function hasActiveFilters(filters: JobOfferFilters): boolean {
  return Object.keys(filters).length > 0;
}

export function toJobOfferApiQuery(filters: JobOfferFilters): JobOfferApiQuery {
  return {
    ...(filters.category ? { category: filters.category } : {}),
    ...(filters.countryCode ? { countryCode: filters.countryCode } : {}),
    ...(filters.city ? { city: filters.city } : {}),
    ...(filters.remote !== undefined ? { remote: String(filters.remote) } : {}),
    ...(filters.q ? { q: filters.q } : {}),
    ...(filters.cursor ? { cursor: filters.cursor } : {}),
    limit: JOB_OFFERS_RESULTS_LIMIT,
  };
}

export function serializeJobOfferFilters(filters: JobOfferFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.category) params.set('category', filters.category);
  if (filters.countryCode) params.set('countryCode', filters.countryCode);
  if (filters.city) params.set('city', filters.city);
  if (filters.remote !== undefined) params.set('remote', String(filters.remote));
  if (filters.q) params.set('q', filters.q);
  if (filters.cursor) params.set('cursor', filters.cursor);
  return params;
}
