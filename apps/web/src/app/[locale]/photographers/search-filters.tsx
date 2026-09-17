import { getTranslations } from 'next-intl/server';
import Link from 'next/link';

import { PHOTOGRAPHER_CATEGORIES, SUPPORTED_LOCALES, type Locale } from '@photoo/shared';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { SearchFilters } from '@/lib/search-params';

import { CityAutocomplete } from './city-autocomplete';
import { NearMeButton } from './near-me-button';

const SELECT_CLASSNAME =
  'h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none';

export async function SearchFiltersForm({
  locale,
  filters,
  action,
  hasActiveFilters,
  clearHref,
}: {
  locale: Locale;
  filters: SearchFilters;
  action: string;
  hasActiveFilters: boolean;
  clearHref: string;
}) {
  const [t, tSearch, tCategories, tLocale] = await Promise.all([
    getTranslations({ locale, namespace: 'web.search.filters' }),
    getTranslations({ locale, namespace: 'web.search' }),
    getTranslations({ locale, namespace: 'common.categories' }),
    getTranslations({ locale, namespace: 'locale' }),
  ]);

  return (
    <form
      method="get"
      action={action}
      role="search"
      aria-label={t('formLabel')}
      className="flex flex-col gap-4 rounded-lg border border-border p-4"
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <CityAutocomplete label={t('cityLabel')} name="city" defaultValue={filters.city} />

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="search-category">{t('categoryLabel')}</Label>
          <select
            id="search-category"
            name="category"
            defaultValue={filters.category ?? ''}
            className={SELECT_CLASSNAME}
          >
            <option value="">{t('allCategories')}</option>
            {PHOTOGRAPHER_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {tCategories(category)}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="search-language">{t('languageLabel')}</Label>
          <select
            id="search-language"
            name="language"
            defaultValue={filters.language ?? ''}
            className={SELECT_CLASSNAME}
          >
            <option value="">{t('allLanguages')}</option>
            {SUPPORTED_LOCALES.map((code) => (
              <option key={code} value={code}>
                {tLocale(code)}
              </option>
            ))}
          </select>
        </div>

        <div className="flex gap-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="search-price-min">{t('priceMinLabel')}</Label>
            <Input
              id="search-price-min"
              name="priceMin"
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              defaultValue={filters.priceMin}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="search-price-max">{t('priceMaxLabel')}</Label>
            <Input
              id="search-price-max"
              name="priceMax"
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              defaultValue={filters.priceMax}
            />
          </div>
        </div>
      </div>

      {filters.lat !== undefined && filters.lng !== undefined ? (
        <>
          <input type="hidden" name="lat" value={filters.lat} />
          <input type="hidden" name="lng" value={filters.lng} />
          <input type="hidden" name="radiusKm" value={filters.radiusKm} />
        </>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit">{t('submit')}</Button>
        <NearMeButton label={t('nearMe')} errorMessage={t('nearMeError')} />
        {hasActiveFilters ? (
          <Link
            href={clearHref}
            className="text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            {tSearch('clearFilters')}
          </Link>
        ) : null}
      </div>
    </form>
  );
}
