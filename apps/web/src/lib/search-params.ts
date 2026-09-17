import {
  CountryCodeSchema,
  LanguageCodeSchema,
  PHOTOGRAPHER_CATEGORIES,
  type PhotographerCategory,
} from '@photoo/shared';

export const SEARCH_RESULTS_LIMIT = 20;
const NEAR_ME_RADIUS_KM = 25;
const COORDINATE_PRECISION_FACTOR = 100;
const CITY_MAX_LENGTH = 120;

export type RawSearchParams = Record<string, string | string[] | undefined>;

export interface SearchFilters {
  city?: string;
  countryCode?: string;
  category?: PhotographerCategory;
  language?: string;
  priceMin?: number;
  priceMax?: number;
  lat?: number;
  lng?: number;
  radiusKm?: number;
  cursor?: string;
}

export interface SearchApiQuery {
  city?: string;
  countryCode?: string;
  category?: PhotographerCategory;
  language?: string;
  priceMinCents?: number;
  priceMaxCents?: number;
  lat?: number;
  lng?: number;
  radiusKm?: number;
  cursor?: string;
  limit: number;
}

const KNOWN_FILTER_KEYS = [
  'city',
  'countryCode',
  'category',
  'language',
  'priceMin',
  'priceMax',
  'lat',
  'lng',
  'radiusKm',
  'cursor',
] as const;

function firstValue(raw: RawSearchParams, key: string): string | undefined {
  const value = raw[key];
  return Array.isArray(value) ? value[0] : value;
}

export function roundCoordinate(value: number): number {
  return Math.round(value * COORDINATE_PRECISION_FACTOR) / COORDINATE_PRECISION_FACTOR;
}

function parseNumber(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseNonNegativeInt(value: string | undefined): number | undefined {
  const parsed = parseNumber(value);
  if (parsed === undefined || !Number.isInteger(parsed) || parsed < 0) {
    return undefined;
  }
  return parsed;
}

function parseLat(value: string | undefined): number | undefined {
  const parsed = parseNumber(value);
  return parsed !== undefined && parsed >= -90 && parsed <= 90 ? parsed : undefined;
}

function parseLng(value: string | undefined): number | undefined {
  const parsed = parseNumber(value);
  return parsed !== undefined && parsed >= -180 && parsed <= 180 ? parsed : undefined;
}

function parseRadiusKm(value: string | undefined): number | undefined {
  const parsed = parseNonNegativeInt(value);
  return parsed !== undefined && parsed >= 1 && parsed <= 200 ? parsed : undefined;
}

// Every field is dropped independently instead of validating the whole
// object against `PhotographerSearchQuerySchema`: that schema's cross-field
// refinements (lat/lng together, priceMin <= priceMax) would reject an
// entire query over one bad field, and this page must never 400 a visitor
// or a crawler (docs/steps/1B.4-discovery.md).
export function parseSearchParams(raw: RawSearchParams): SearchFilters {
  const filters: SearchFilters = {};

  const city = firstValue(raw, 'city')?.trim();
  if (city && city.length > 0 && city.length <= CITY_MAX_LENGTH) {
    filters.city = city;
  }

  const countryCode = firstValue(raw, 'countryCode');
  if (countryCode && CountryCodeSchema.safeParse(countryCode).success) {
    filters.countryCode = countryCode;
  }

  const category = firstValue(raw, 'category');
  if (category && (PHOTOGRAPHER_CATEGORIES as readonly string[]).includes(category)) {
    filters.category = category as PhotographerCategory;
  }

  const language = firstValue(raw, 'language');
  if (language && LanguageCodeSchema.safeParse(language).success) {
    filters.language = language;
  }

  const priceMin = parseNonNegativeInt(firstValue(raw, 'priceMin'));
  const priceMax = parseNonNegativeInt(firstValue(raw, 'priceMax'));
  if (priceMin === undefined || priceMax === undefined || priceMin <= priceMax) {
    if (priceMin !== undefined) {
      filters.priceMin = priceMin;
    }
    if (priceMax !== undefined) {
      filters.priceMax = priceMax;
    }
  }

  const lat = parseLat(firstValue(raw, 'lat'));
  const lng = parseLng(firstValue(raw, 'lng'));
  if (lat !== undefined && lng !== undefined) {
    filters.lat = roundCoordinate(lat);
    filters.lng = roundCoordinate(lng);
    filters.radiusKm = parseRadiusKm(firstValue(raw, 'radiusKm')) ?? NEAR_ME_RADIUS_KM;
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

export function toApiQuery(filters: SearchFilters): SearchApiQuery {
  return {
    ...(filters.city ? { city: filters.city } : {}),
    ...(filters.countryCode ? { countryCode: filters.countryCode } : {}),
    ...(filters.category ? { category: filters.category } : {}),
    ...(filters.language ? { language: filters.language } : {}),
    ...(filters.priceMin !== undefined ? { priceMinCents: filters.priceMin * 100 } : {}),
    ...(filters.priceMax !== undefined ? { priceMaxCents: filters.priceMax * 100 } : {}),
    ...(filters.lat !== undefined ? { lat: filters.lat } : {}),
    ...(filters.lng !== undefined ? { lng: filters.lng } : {}),
    ...(filters.radiusKm !== undefined ? { radiusKm: filters.radiusKm } : {}),
    ...(filters.cursor ? { cursor: filters.cursor } : {}),
    limit: SEARCH_RESULTS_LIMIT,
  };
}

export function serializeSearchFilters(filters: SearchFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.city) params.set('city', filters.city);
  if (filters.countryCode) params.set('countryCode', filters.countryCode);
  if (filters.category) params.set('category', filters.category);
  if (filters.language) params.set('language', filters.language);
  if (filters.priceMin !== undefined) params.set('priceMin', String(filters.priceMin));
  if (filters.priceMax !== undefined) params.set('priceMax', String(filters.priceMax));
  if (filters.lat !== undefined) params.set('lat', String(filters.lat));
  if (filters.lng !== undefined) params.set('lng', String(filters.lng));
  if (filters.radiusKm !== undefined) params.set('radiusKm', String(filters.radiusKm));
  if (filters.cursor) params.set('cursor', filters.cursor);
  return params;
}

export function hasActiveFilters(filters: SearchFilters): boolean {
  return Object.keys(filters).length > 0;
}
