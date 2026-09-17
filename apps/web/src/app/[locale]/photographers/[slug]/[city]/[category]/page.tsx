import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';

import { isLocale, type Locale } from '@photoo/shared';

import { countryDisplayName } from '@/lib/country-name';
import { isPhotographerCategory } from '@/lib/discovery';
import { env } from '@/lib/env';
import { buildItemListJsonLd } from '@/lib/landing-jsonld';
import { serializeJsonLd } from '@/lib/profile-jsonld';
import { buildRobotsMetadata } from '@/lib/robots';
import { absoluteUrl, localeAlternates } from '@/lib/site-url';

import { PhotographerCard } from '../../../photographer-card';
import { resolveCategoryLanding } from '../../landing-data';
import { CategoryLinks, CityLinks } from '../../landing-links';

function categoryPath(countryCode: string, citySlug: string, category: string): string {
  return `/photographers/${countryCode.toLowerCase()}/${citySlug}/${category}`;
}

async function resolve(countryCode: string, citySlug: string, category: string) {
  if (!isPhotographerCategory(category)) {
    return null;
  }
  return resolveCategoryLanding(countryCode, citySlug, category);
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string; city: string; category: string }>;
}): Promise<Metadata> {
  const { locale: requestedLocale, slug, city: citySlug, category } = await params;
  if (!isLocale(requestedLocale)) {
    return {};
  }
  const locale: Locale = requestedLocale;
  const countryCode = slug.toUpperCase();

  const result = await resolve(countryCode, citySlug, category);
  if (!result) {
    return {};
  }

  const [t, tCategories] = await Promise.all([
    getTranslations({ locale, namespace: 'web.landing' }),
    getTranslations({ locale, namespace: 'common.categories' }),
  ]);
  const place = `${result.city.name}, ${countryDisplayName(countryCode, locale)}`;
  const categoryLabel = tCategories(result.category);
  const path = categoryPath(countryCode, citySlug, category);

  return {
    title: t('categoryMetaTitle', { category: categoryLabel, place }),
    description: t('categoryMetaDescription', { category: categoryLabel, place }),
    robots: buildRobotsMetadata(
      env.NEXT_PUBLIC_ALLOW_INDEXING && result.photographers.items.length > 0,
    ),
    alternates: {
      canonical: absoluteUrl(locale, path),
      languages: localeAlternates(path),
    },
  };
}

export default async function CategoryLandingPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string; city: string; category: string }>;
}) {
  const { locale: requestedLocale, slug, city: citySlug, category } = await params;
  if (!isLocale(requestedLocale)) {
    notFound();
  }
  const locale: Locale = requestedLocale;
  const countryCode = slug.toUpperCase();

  const [result, headersList] = await Promise.all([
    resolve(countryCode, citySlug, category),
    headers(),
  ]);
  if (!result) {
    notFound();
  }
  const { city, cities, photographers } = result;

  const nonce = headersList.get('x-nonce');
  const [t, tCategories] = await Promise.all([
    getTranslations({ locale, namespace: 'web.landing' }),
    getTranslations({ locale, namespace: 'common.categories' }),
  ]);
  const place = `${city.name}, ${countryDisplayName(countryCode, locale)}`;
  const categoryLabel = tCategories(result.category);

  const jsonLd = buildItemListJsonLd({
    items: photographers.items,
    urlFor: (photographerSlug) => absoluteUrl(locale, `/photographers/${photographerSlug}`),
  });

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-12">
      <script
        type="application/ld+json"
        nonce={nonce ?? undefined}
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
      />
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold text-foreground">
          {t('categoryHeading', {
            count: photographers.items.length,
            category: categoryLabel,
            place,
          })}
        </h1>
        <p className="text-muted-foreground">{t('intro')}</p>
      </div>

      {photographers.items.length === 0 ? (
        <p className="text-muted-foreground">{t('empty')}</p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {photographers.items.map((photographer) => (
            <PhotographerCard key={photographer.id} photographer={photographer} locale={locale} />
          ))}
        </ul>
      )}

      <CategoryLinks
        locale={locale}
        countryCode={countryCode}
        citySlug={citySlug}
        currentCategory={result.category}
        heading={t('categoriesHeading')}
      />

      {cities.length > 1 ? (
        <CityLinks
          locale={locale}
          countryCode={countryCode}
          cities={cities}
          currentCitySlug={citySlug}
          category={result.category}
          heading={t('topCitiesHeading')}
        />
      ) : null}
    </div>
  );
}
