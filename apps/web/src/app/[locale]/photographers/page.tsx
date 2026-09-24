import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { isLocale, type Locale } from '@photoo/shared';

import { api } from '@/lib/api';
import { env } from '@/lib/env';
import { buildRobotsMetadata } from '@/lib/robots';
import {
  hasActiveFilters,
  hasAnyFilterParam,
  parseSearchParams,
  serializeSearchFilters,
  toApiQuery,
  type RawSearchParams,
} from '@/lib/search-params';
import { absoluteUrl, localeAlternates } from '@/lib/site-url';

import { PhotographerCard } from './photographer-card';
import { SearchFiltersForm } from './search-filters';

const REVALIDATE_SECONDS = 300;
const SEARCH_PATH = '/photographers';

export async function generateMetadata({
  searchParams,
  params,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<RawSearchParams>;
}): Promise<Metadata> {
  const [{ locale: requestedLocale }, rawParams] = await Promise.all([params, searchParams]);
  if (!isLocale(requestedLocale)) {
    return {};
  }
  const locale: Locale = requestedLocale;

  const t = await getTranslations({ locale, namespace: 'web.search' });
  const filtered = hasAnyFilterParam(rawParams);
  const filters = parseSearchParams(rawParams);
  const { data, response } = await api.GET('/v1/photographers', {
    params: { query: toApiQuery(filters) },
    next: { revalidate: REVALIDATE_SECONDS },
  });
  if (!data) {
    throw new Error(`Failed to search photographers: HTTP ${String(response.status)}`);
  }
  const isEmpty = data.items.length === 0;

  return {
    title: t('metaTitle'),
    description: t('metaDescription'),
    robots: buildRobotsMetadata(env.NEXT_PUBLIC_ALLOW_INDEXING && !filtered && !isEmpty),
    alternates: {
      canonical: absoluteUrl(locale, SEARCH_PATH),
      languages: localeAlternates(SEARCH_PATH),
    },
  };
}

export default async function PhotographersSearchPage({
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

  const filters = parseSearchParams(rawParams);
  const query = toApiQuery(filters);

  const { data, response } = await api.GET('/v1/photographers', {
    params: { query },
    next: { revalidate: REVALIDATE_SECONDS },
  });
  if (!data) {
    throw new Error(`Failed to search photographers: HTTP ${String(response.status)}`);
  }

  const t = await getTranslations({ locale, namespace: 'web.search' });
  const activeFilters = hasActiveFilters(filters);
  const formAction = `/${locale}${SEARCH_PATH}`;
  const clearHref = formAction;

  const loadMoreHref = data.nextCursor
    ? `${formAction}?${serializeSearchFilters({ ...filters, cursor: data.nextCursor }).toString()}`
    : null;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-12">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold text-foreground">{t('title')}</h1>
        <p className="text-muted-foreground">{t('intro')}</p>
      </div>

      <SearchFiltersForm
        locale={locale}
        filters={filters}
        action={formAction}
        hasActiveFilters={activeFilters}
        clearHref={clearHref}
      />

      {data.items.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border py-16 text-center">
          <p className="text-muted-foreground">{t('empty')}</p>
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
            {data.items.map((photographer) => (
              <PhotographerCard key={photographer.id} photographer={photographer} locale={locale} />
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
