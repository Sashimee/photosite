import { PHOTOGRAPHER_CATEGORIES, SUPPORTED_LOCALES } from '@photoo/shared';
import type { MetadataRoute } from 'next';

import {
  loadEnabledCountryCodes,
  resolveCategoryLanding,
  resolveCityLanding,
  resolveCountryLanding,
} from '@/app/[locale]/photographers/[slug]/landing-data';

import { api } from './api';
import { isCountrySegment } from './discovery';
import { absoluteUrl, localeAlternates } from './site-url';

const PHOTOGRAPHERS_PAGE_LIMIT = 100;

// Mirrors the checks each page's own `generateMetadata` already makes before
// setting `robots: buildRobotsMetadata(... && !isEmpty)`, so the sitemap can
// never advertise a path the page itself would noindex as thin.
async function fetchStaticPaths(): Promise<string[]> {
  const paths = ['/'];

  const [photographers, jobOffers] = await Promise.all([
    api.GET('/v1/photographers', { params: { query: { limit: 1 } } }),
    api.GET('/v1/job-offers', { params: { query: { limit: 1 } } }),
  ]);
  if (!photographers.data) {
    throw new Error(
      `Failed to load photographers for the sitemap: HTTP ${String(photographers.response.status)}`,
    );
  }
  if (!jobOffers.data) {
    throw new Error(
      `Failed to load job offers for the sitemap: HTTP ${String(jobOffers.response.status)}`,
    );
  }

  if (photographers.data.items.length > 0) {
    paths.push('/photographers');
  }
  if (jobOffers.data.items.length > 0) {
    paths.push('/job-offers');
  }

  // TODO(1B.11c): add `/job-offers/{slug}` for every open offer from
  // `GET /v1/job-offers`, once the job board (1B.9) is live - see this
  // module's own doc comment for the shape a new source function should take.
  return paths;
}

async function fetchPhotographerProfilePaths(): Promise<string[]> {
  const paths: string[] = [];
  let cursor: string | undefined;

  for (;;) {
    const { data, response } = await api.GET('/v1/photographers', {
      params: { query: { limit: PHOTOGRAPHERS_PAGE_LIMIT, ...(cursor ? { cursor } : {}) } },
    });
    if (!data) {
      throw new Error(
        `Failed to page through photographers for the sitemap: HTTP ${String(response.status)}`,
      );
    }
    for (const item of data.items) {
      // `SlugSchema.min(3)` already makes this unreachable in production,
      // but such a slug would be routed as a country landing page instead
      // of a profile (`isCountrySegment`).
      if (isCountrySegment(item.slug)) {
        throw new Error(
          `Photographer slug "${item.slug}" is indistinguishable from a country segment; refusing to add it to the sitemap`,
        );
      }
      paths.push(`/photographers/${item.slug}`);
    }
    if (!data.nextCursor) {
      break;
    }
    cursor = data.nextCursor;
  }

  return paths;
}

// Reuses the exact loaders the discovery landing pages use to decide their
// own `noindex` (`docs/steps/1B.11-seo.md`'s thin-landing-page rule), rather
// than re-querying the search endpoint with slightly different logic that
// could drift from what the pages actually render.
async function fetchDiscoveryLandingPaths(): Promise<string[]> {
  const paths: string[] = [];
  const countryCodes = await loadEnabledCountryCodes();

  for (const countryCode of countryCodes) {
    const country = await resolveCountryLanding(countryCode);
    if (!country || country.photographers.items.length === 0) {
      continue;
    }
    paths.push(`/photographers/${countryCode.toLowerCase()}`);

    for (const city of country.cities) {
      const cityLanding = await resolveCityLanding(countryCode, city.slug);
      if (!cityLanding || cityLanding.photographers.items.length === 0) {
        continue;
      }
      paths.push(`/photographers/${countryCode.toLowerCase()}/${city.slug}`);

      for (const category of PHOTOGRAPHER_CATEGORIES) {
        const categoryLanding = await resolveCategoryLanding(countryCode, city.slug, category);
        if (!categoryLanding || categoryLanding.photographers.items.length === 0) {
          continue;
        }
        paths.push(`/photographers/${countryCode.toLowerCase()}/${city.slug}/${category}`);
      }
    }
  }

  return paths;
}

function toSitemapEntries(paths: readonly string[]): MetadataRoute.Sitemap {
  return paths.flatMap((path) =>
    SUPPORTED_LOCALES.map((locale) => ({
      url: absoluteUrl(locale, path === '/' ? '' : path),
      alternates: { languages: localeAlternates(path === '/' ? '' : path) },
    })),
  );
}

// The single seam 1B.11c needs: add a `fetchJobOfferDetailPaths()` source
// alongside the ones above (paginating `GET /v1/job-offers` the same way
// `fetchPhotographerProfilePaths` paginates `/v1/photographers`, mapping each
// item's `slug` to `/job-offers/{slug}`) and include it in the
// `Promise.all` below - no restructuring of this function or of
// `app/sitemap.ts`.
export async function buildSitemapPaths(): Promise<string[]> {
  const [staticPaths, profilePaths, landingPaths] = await Promise.all([
    fetchStaticPaths(),
    fetchPhotographerProfilePaths(),
    fetchDiscoveryLandingPaths(),
  ]);
  return [...staticPaths, ...profilePaths, ...landingPaths];
}

export async function buildSitemap(): Promise<MetadataRoute.Sitemap> {
  const paths = await buildSitemapPaths();
  return toSitemapEntries(paths);
}
