import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cache } from 'react';

import { isLocale, type Locale, type PhotographerCategory } from '@photoo/shared';

import { api } from '@/lib/api';
import { env } from '@/lib/env';
import { buildRobotsMetadata } from '@/lib/robots';
import { absoluteUrl, localeAlternates } from '@/lib/site-url';

import { JobOfferCard } from './job-offer-card';
import { JobOfferFiltersForm } from './job-offer-filters';
import {
  hasActiveFilters,
  hasAnyFilterParam,
  parseJobOfferSearchParams,
  serializeJobOfferFilters,
  toJobOfferApiQuery,
  type JobOfferFilters,
  type RawSearchParams,
} from './job-offer-search-params';

const REVALIDATE_SECONDS = 300;
const COUNTRIES_REVALIDATE_SECONDS = 3600;
const JOB_OFFERS_PATH = '/job-offers';

// Keyed by the individual filter primitives, not the `JobOfferFilters`
// object, so `generateMetadata` and the page body - which each build their
// own `filters` object from the same `rawParams` - hit `cache()`'s dedup
// instead of two separate requests: React's `cache()` compares arguments by
// value, and two structurally-equal but distinct objects don't match.
const loadJobOffers = cache(
  async (
    category: PhotographerCategory | undefined,
    countryCode: string | undefined,
    city: string | undefined,
    remote: boolean | undefined,
    q: string | undefined,
    cursor: string | undefined,
  ) => {
    const query = toJobOfferApiQuery({
      ...(category ? { category } : {}),
      ...(countryCode ? { countryCode } : {}),
      ...(city ? { city } : {}),
      ...(remote !== undefined ? { remote } : {}),
      ...(q ? { q } : {}),
      ...(cursor ? { cursor } : {}),
    });
    const { data, response } = await api.GET('/v1/job-offers', {
      params: { query },
      next: { revalidate: REVALIDATE_SECONDS },
    });
    if (!data) {
      throw new Error(`Failed to search job offers: HTTP ${String(response.status)}`);
    }
    return data;
  },
);

function loadJobOffersForFilters(filters: JobOfferFilters) {
  return loadJobOffers(
    filters.category,
    filters.countryCode,
    filters.city,
    filters.remote,
    filters.q,
    filters.cursor,
  );
}

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<RawSearchParams>;
}): Promise<Metadata> {
  const [{ locale: requestedLocale }, rawParams] = await Promise.all([params, searchParams]);
  if (!isLocale(requestedLocale)) {
    return {};
  }
  const locale: Locale = requestedLocale;

  const t = await getTranslations({ locale, namespace: 'web.jobBoard' });
  const filtered = hasAnyFilterParam(rawParams);
  const data = await loadJobOffersForFilters(parseJobOfferSearchParams(rawParams));
  const isEmpty = data.items.length === 0;

  return {
    title: t('metaTitle'),
    description: t('metaDescription'),
    robots: buildRobotsMetadata(env.NEXT_PUBLIC_ALLOW_INDEXING && !filtered && !isEmpty),
    alternates: {
      canonical: absoluteUrl(locale, JOB_OFFERS_PATH),
      languages: localeAlternates(JOB_OFFERS_PATH),
    },
  };
}

export default async function JobOffersBoardPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<RawSearchParams>;
}) {
  const [{ locale: requestedLocale }, rawParams] = await Promise.all([params, searchParams]);
  if (!isLocale(requestedLocale)) {
    notFound();
  }
  const locale: Locale = requestedLocale;

  const filters = parseJobOfferSearchParams(rawParams);

  const [data, countriesResult] = await Promise.all([
    loadJobOffersForFilters(filters),
    api.GET('/v1/countries', { next: { revalidate: COUNTRIES_REVALIDATE_SECONDS } }),
  ]);
  if (!countriesResult.data) {
    throw new Error(`Failed to load countries: HTTP ${String(countriesResult.response.status)}`);
  }

  const t = await getTranslations({ locale, namespace: 'web.jobBoard' });
  const activeFilters = hasActiveFilters(filters);
  const formAction = `/${locale}${JOB_OFFERS_PATH}`;
  const clearHref = formAction;

  const loadMoreHref = data.nextCursor
    ? `${formAction}?${serializeJobOfferFilters({ ...filters, cursor: data.nextCursor }).toString()}`
    : null;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-12">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold text-foreground">{t('title')}</h1>
        <p className="text-muted-foreground">{t('intro')}</p>
      </div>

      <JobOfferFiltersForm
        locale={locale}
        filters={filters}
        countries={countriesResult.data}
        action={formAction}
        hasActiveFilters={activeFilters}
        clearHref={clearHref}
      />

      {data.items.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border py-16 text-center">
          <p className="text-muted-foreground">{activeFilters ? t('emptyFiltered') : t('empty')}</p>
          {activeFilters ? (
            <Link
              href={clearHref}
              className="text-sm font-medium text-primary underline-offset-4 hover:underline"
            >
              {t('clearFilters')}
            </Link>
          ) : null}
        </div>
      ) : (
        <>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data.items.map((offer) => (
              <JobOfferCard key={offer.id} offer={offer} locale={locale} />
            ))}
          </ul>
          {loadMoreHref ? (
            <Link
              href={loadMoreHref}
              className="self-center text-sm font-medium text-primary underline-offset-4 hover:underline"
            >
              {t('loadMore')}
            </Link>
          ) : null}
        </>
      )}
    </div>
  );
}
