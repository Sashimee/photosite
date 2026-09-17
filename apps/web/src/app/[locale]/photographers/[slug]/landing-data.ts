import { cache } from 'react';

import type { components } from '@photoo/api-client';
import type { PhotographerCategory } from '@photoo/shared';

import { api } from '@/lib/api';
import { isEnabledCountryCode, resolveCityBySlug } from '@/lib/discovery';

type CitySummary = components['schemas']['CitySummary'];

export const LANDING_REVALIDATE_SECONDS = 3600;
export const LANDING_RESULTS_LIMIT = 20;
// The API's own max (`CitiesQuerySchema.limit`); a country with more than
// 20 distinct cities can't be fully resolved by slug yet, see the 1B.4b
// report.
export const LANDING_CITIES_LIMIT = 20;

export const loadCountryCities = cache(async (countryCode: string): Promise<CitySummary[]> => {
  const { data, response } = await api.GET('/v1/cities', {
    params: { query: { countryCode, limit: LANDING_CITIES_LIMIT } },
    next: { revalidate: LANDING_REVALIDATE_SECONDS },
  });
  if (!data) {
    throw new Error(
      `Failed to load cities for country "${countryCode}": HTTP ${String(response.status)}`,
    );
  }
  return data;
});

export const searchLandingPhotographers = cache(
  async (countryCode: string, city?: string, category?: PhotographerCategory) => {
    const { data, response } = await api.GET('/v1/photographers', {
      params: {
        query: {
          countryCode,
          ...(city ? { city } : {}),
          ...(category ? { category } : {}),
          limit: LANDING_RESULTS_LIMIT,
        },
      },
      next: { revalidate: LANDING_REVALIDATE_SECONDS },
    });
    if (!data) {
      const context = [
        `country "${countryCode}"`,
        city ? `city "${city}"` : null,
        category ? `category "${category}"` : null,
      ]
        .filter(Boolean)
        .join(', ');
      throw new Error(
        `Failed to search photographers for ${context}: HTTP ${String(response.status)}`,
      );
    }
    return data;
  },
);

export const resolveCountryLanding = cache(async (countryCode: string) => {
  if (!isEnabledCountryCode(countryCode)) {
    return null;
  }
  const [cities, photographers] = await Promise.all([
    loadCountryCities(countryCode),
    searchLandingPhotographers(countryCode),
  ]);
  return { cities, photographers };
});

export const resolveCityLanding = cache(async (countryCode: string, citySlug: string) => {
  if (!isEnabledCountryCode(countryCode)) {
    return null;
  }
  const cities = await loadCountryCities(countryCode);
  const city = resolveCityBySlug(cities, citySlug);
  if (!city) {
    return null;
  }
  const photographers = await searchLandingPhotographers(countryCode, city.name);
  return { city, cities, photographers };
});

export const resolveCategoryLanding = cache(
  async (countryCode: string, citySlug: string, category: PhotographerCategory) => {
    const base = await resolveCityLanding(countryCode, citySlug);
    if (!base) {
      return null;
    }
    const photographers = await searchLandingPhotographers(countryCode, base.city.name, category);
    return { city: base.city, cities: base.cities, photographers, category };
  },
);
