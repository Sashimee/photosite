import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';

import { isLocale, type Locale } from '@photoo/shared';

import { countryDisplayName } from '@/lib/country-name';
import { env } from '@/lib/env';
import { buildItemListJsonLd } from '@/lib/landing-jsonld';
import { serializeJsonLd } from '@/lib/profile-jsonld';
import { buildRobotsMetadata } from '@/lib/robots';
import { absoluteUrl, localeAlternates } from '@/lib/site-url';

import { PhotographerCard } from '../../photographer-card';
import { resolveCityLanding } from '../landing-data';
import { CategoryLinks, CityLinks } from '../landing-links';

function cityPath(countryCode: string, citySlug: string): string {
  return `/photographers/${countryCode.toLowerCase()}/${citySlug}`;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string; city: string }>;
}): Promise<Metadata> {
  const { locale: requestedLocale, slug, city: citySlug } = await params;
  if (!isLocale(requestedLocale)) {
    return {};
  }
  const locale: Locale = requestedLocale;
  const countryCode = slug.toUpperCase();

  const result = await resolveCityLanding(countryCode, citySlug);
  if (!result) {
    return {};
  }

  const t = await getTranslations({ locale, namespace: 'web.landing' });
  const place = `${result.city.name}, ${countryDisplayName(countryCode, locale)}`;
  const path = cityPath(countryCode, citySlug);

  return {
    title: t('cityMetaTitle', { place }),
    description: t('cityMetaDescription', { place }),
    robots: buildRobotsMetadata(
      env.NEXT_PUBLIC_ALLOW_INDEXING && result.photographers.items.length > 0,
    ),
    alternates: {
      canonical: absoluteUrl(locale, path),
      languages: localeAlternates(path),
    },
  };
}

export default async function CityLandingPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string; city: string }>;
}) {
  const { locale: requestedLocale, slug, city: citySlug } = await params;
  if (!isLocale(requestedLocale)) {
    notFound();
  }
  const locale: Locale = requestedLocale;
  const countryCode = slug.toUpperCase();

  const [result, headersList] = await Promise.all([
    resolveCityLanding(countryCode, citySlug),
    headers(),
  ]);
  if (!result) {
    notFound();
  }
  const { city, cities, photographers } = result;

  const nonce = headersList.get('x-nonce');
  const t = await getTranslations({ locale, namespace: 'web.landing' });
  const place = `${city.name}, ${countryDisplayName(countryCode, locale)}`;

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
          {t('cityHeading', { count: photographers.items.length, place })}
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
        heading={t('categoriesHeading')}
      />

      {cities.length > 1 ? (
        <CityLinks
          locale={locale}
          countryCode={countryCode}
          cities={cities}
          currentCitySlug={citySlug}
          heading={t('topCitiesHeading')}
        />
      ) : null}
    </div>
  );
}
