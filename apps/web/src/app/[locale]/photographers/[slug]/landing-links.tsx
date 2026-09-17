import { getTranslations } from 'next-intl/server';
import Link from 'next/link';

import type { components } from '@photoo/api-client';
import { PHOTOGRAPHER_CATEGORIES, type Locale, type PhotographerCategory } from '@photoo/shared';

type CitySummary = components['schemas']['CitySummary'];

const LINK_CLASSNAME =
  'rounded-full border border-border px-3 py-1 text-sm text-foreground hover:bg-accent';

export function CityLinks({
  locale,
  countryCode,
  cities,
  currentCitySlug,
  category,
  heading,
}: {
  locale: Locale;
  countryCode: string;
  cities: readonly CitySummary[];
  currentCitySlug?: string | undefined;
  category?: PhotographerCategory | undefined;
  heading: string;
}) {
  const others = cities.filter((city) => city.slug !== currentCitySlug);
  if (others.length === 0) {
    return null;
  }

  return (
    <nav aria-label={heading} className="flex flex-col gap-2">
      <h2 className="text-lg font-semibold text-foreground">{heading}</h2>
      <ul className="flex flex-wrap gap-2">
        {others.map((city) => {
          const segments = [countryCode.toLowerCase(), city.slug, ...(category ? [category] : [])];
          return (
            <li key={city.slug}>
              <Link
                href={`/${locale}/photographers/${segments.join('/')}`}
                className={LINK_CLASSNAME}
              >
                {city.name}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export async function CategoryLinks({
  locale,
  countryCode,
  citySlug,
  currentCategory,
  heading,
}: {
  locale: Locale;
  countryCode: string;
  citySlug: string;
  currentCategory?: PhotographerCategory | undefined;
  heading: string;
}) {
  const tCategories = await getTranslations({ locale, namespace: 'common.categories' });
  const others = PHOTOGRAPHER_CATEGORIES.filter((category) => category !== currentCategory);

  return (
    <nav aria-label={heading} className="flex flex-col gap-2">
      <h2 className="text-lg font-semibold text-foreground">{heading}</h2>
      <ul className="flex flex-wrap gap-2">
        {others.map((category) => (
          <li key={category}>
            <Link
              href={`/${locale}/photographers/${countryCode.toLowerCase()}/${citySlug}/${category}`}
              className={LINK_CLASSNAME}
            >
              {tCategories(category)}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
