import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';

import type { Locale } from '@photoo/shared';

import { countryDisplayName } from '@/lib/country-name';
import { buildItemListJsonLd } from '@/lib/landing-jsonld';
import { serializeJsonLd } from '@/lib/profile-jsonld';
import { buildRobotsMetadata } from '@/lib/robots';
import { env } from '@/lib/env';
import { absoluteUrl, localeAlternates } from '@/lib/site-url';

import { PhotographerCard } from '../photographer-card';
import { CityLinks } from './landing-links';
import { resolveCountryLanding } from './landing-data';

function countryPath(countryCode: string): string {
  return `/photographers/${countryCode.toLowerCase()}`;
}

export async function generateCountryLandingMetadata({
  locale,
  countryCode,
}: {
  locale: Locale;
  countryCode: string;
}): Promise<Metadata> {
  const result = await resolveCountryLanding(countryCode);
  if (!result) {
    return {};
  }

  const t = await getTranslations({ locale, namespace: 'web.landing' });
  const place = countryDisplayName(countryCode, locale);
  const path = countryPath(countryCode);

  return {
    title: t('countryMetaTitle', { place }),
    description: t('countryMetaDescription', { place }),
    robots: buildRobotsMetadata(
      env.NEXT_PUBLIC_ALLOW_INDEXING && result.photographers.items.length > 0,
    ),
    alternates: {
      canonical: absoluteUrl(locale, path),
      languages: localeAlternates(path),
    },
  };
}

export async function CountryLandingPage({
  locale,
  countryCode,
}: {
  locale: Locale;
  countryCode: string;
}) {
  const [result, headersList] = await Promise.all([resolveCountryLanding(countryCode), headers()]);
  if (!result) {
    notFound();
  }
  const { cities, photographers } = result;

  const nonce = headersList.get('x-nonce');
  const t = await getTranslations({ locale, namespace: 'web.landing' });
  const place = countryDisplayName(countryCode, locale);

  const jsonLd = buildItemListJsonLd({
    items: photographers.items,
    urlFor: (slug) => absoluteUrl(locale, `/photographers/${slug}`),
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
          {t('countryHeading', { count: photographers.items.length, place })}
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

      {cities.length > 0 ? (
        <CityLinks
          locale={locale}
          countryCode={countryCode}
          cities={cities}
          heading={t('topCitiesHeading')}
        />
      ) : null}
    </div>
  );
}
