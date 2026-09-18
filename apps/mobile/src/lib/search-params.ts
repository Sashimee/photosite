import { PhotographerSearchQuerySchema, type PhotographerCategory } from '@photoo/shared';
import type { z } from 'zod';

export type PhotographerSearchQuery = z.infer<typeof PhotographerSearchQuerySchema>;

export type SearchFilters = Omit<PhotographerSearchQuery, 'cursor' | 'limit'>;

export type RouterParams = Record<string, string | string[] | undefined>;

const FILTER_KEYS = Object.keys(PhotographerSearchQuerySchema.shape).filter(
  (key) => key !== 'cursor' && key !== 'limit',
) as (keyof SearchFilters)[];

function firstValue(params: RouterParams, key: string): string | undefined {
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

// Feeds the raw string params straight into `PhotographerSearchQuerySchema`
// (coercion and cross-field refinements included) instead of re-validating
// each field by hand: this is app-only navigation state, never a crawlable
// page, so an invalid combination can safely fall back to no filters rather
// than needing the field-by-field tolerance apps/web/src/lib/search-params.ts
// documents for itself.
export function parseSearchFilters(params: RouterParams): SearchFilters {
  const candidate: Record<string, string> = {};
  for (const key of FILTER_KEYS) {
    const value = firstValue(params, key);
    if (value !== undefined) {
      candidate[key] = value;
    }
  }

  const parsed = PhotographerSearchQuerySchema.safeParse(candidate);
  if (!parsed.success) {
    return {};
  }

  const filters: Record<string, unknown> = { ...parsed.data };
  delete filters.cursor;
  delete filters.limit;
  return filters;
}

export function hasActiveFilters(filters: SearchFilters): boolean {
  return Object.keys(filters).length > 0;
}

export function serializeSearchFilters(filters: SearchFilters): URLSearchParams {
  const params = new URLSearchParams();
  for (const key of FILTER_KEYS) {
    const value = filters[key];
    if (value !== undefined) {
      params.set(key, String(value));
    }
  }
  return params;
}

export function searchFiltersToHref(filters: SearchFilters): string {
  const query = serializeSearchFilters(filters).toString();
  return query ? `/?${query}` : '/';
}

export interface SearchPagination {
  cursor?: string;
  limit: number;
}

export interface SearchApiQuery {
  lat?: number;
  lng?: number;
  radiusKm?: number;
  city?: string;
  countryCode?: string;
  category?: PhotographerCategory;
  language?: string;
  priceMinCents?: number;
  priceMaxCents?: number;
  cursor?: string;
  limit: number;
}

// Built key-by-key, rather than spread from `filters`/`pagination` directly,
// so an absent filter is an omitted key rather than an explicit `undefined`:
// the generated client's query type is `T | null` for the nullable fields,
// which `exactOptionalPropertyTypes` treats as incompatible with `T | undefined`.
export function toApiQuery(filters: SearchFilters, pagination: SearchPagination): SearchApiQuery {
  const query: SearchApiQuery = { limit: pagination.limit };
  if (filters.lat !== undefined) {
    query.lat = filters.lat;
  }
  if (filters.lng !== undefined) {
    query.lng = filters.lng;
  }
  if (filters.radiusKm !== undefined) {
    query.radiusKm = filters.radiusKm;
  }
  if (filters.city !== undefined) {
    query.city = filters.city;
  }
  if (filters.countryCode !== undefined) {
    query.countryCode = filters.countryCode;
  }
  if (filters.category !== undefined) {
    query.category = filters.category;
  }
  if (filters.language !== undefined) {
    query.language = filters.language;
  }
  if (filters.priceMinCents !== undefined) {
    query.priceMinCents = filters.priceMinCents;
  }
  if (filters.priceMaxCents !== undefined) {
    query.priceMaxCents = filters.priceMaxCents;
  }
  if (pagination.cursor !== undefined) {
    query.cursor = pagination.cursor;
  }
  return query;
}
