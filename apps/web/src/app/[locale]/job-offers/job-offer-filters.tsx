import { getTranslations } from 'next-intl/server';
import Link from 'next/link';

import type { components } from '@photoo/api-client';
import { PHOTOGRAPHER_CATEGORIES, type Locale } from '@photoo/shared';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

import { CityAutocomplete } from '../photographers/city-autocomplete';
import type { JobOfferFilters } from './job-offer-search-params';

type CountrySummary = components['schemas']['CountrySummary'];

const SELECT_CLASSNAME =
  'h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none';

export async function JobOfferFiltersForm({
  locale,
  filters,
  countries,
  action,
  hasActiveFilters,
  clearHref,
}: {
  locale: Locale;
  filters: JobOfferFilters;
  countries: CountrySummary[];
  action: string;
  hasActiveFilters: boolean;
  clearHref: string;
}) {
  const [t, tBoard, tCategories] = await Promise.all([
    getTranslations({ locale, namespace: 'web.jobBoard.filters' }),
    getTranslations({ locale, namespace: 'web.jobBoard' }),
    getTranslations({ locale, namespace: 'common.categories' }),
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
          <Label htmlFor="job-offers-category">{t('categoryLabel')}</Label>
          <select
            id="job-offers-category"
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
          <Label htmlFor="job-offers-country">{t('countryLabel')}</Label>
          <select
            id="job-offers-country"
            name="countryCode"
            defaultValue={filters.countryCode ?? ''}
            className={SELECT_CLASSNAME}
          >
            <option value="">{t('allCountries')}</option>
            {countries.map((country) => (
              <option key={country.code} value={country.code}>
                {country.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="job-offers-q">{t('queryLabel')}</Label>
          <Input id="job-offers-q" name="q" defaultValue={filters.q} />
        </div>
      </div>

      <label className="flex items-center gap-3 text-sm text-foreground">
        <Switch name="remote" value="true" defaultChecked={filters.remote === true} />
        {t('remoteOnlyLabel')}
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit">{t('submit')}</Button>
        {hasActiveFilters ? (
          <Link
            href={clearHref}
            className="text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            {tBoard('clearFilters')}
          </Link>
        ) : null}
      </div>
    </form>
  );
}
