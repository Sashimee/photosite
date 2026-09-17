import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { cache } from 'react';

import { DEFAULT_LOCALE, isLocale, SUPPORTED_LOCALES, type Locale } from '@photoo/shared';

import { api } from '@/lib/api';
import { env } from '@/lib/env';
import { isCountrySegment } from '@/lib/discovery';
import { resolveLocalizedText } from '@/lib/localized-text';
import { buildProfileJsonLd, serializeJsonLd } from '@/lib/profile-jsonld';
import { buildRobotsMetadata } from '@/lib/robots';
import { truncateAtWordBoundary } from '@/lib/truncate';

import { CountryLandingPage, generateCountryLandingMetadata } from './country-landing';
import { PortfolioGrid } from './portfolio-grid';
import { ProductList } from './product-list';
import { ProfileBio } from './profile-bio';
import { ProfileHeader } from './profile-header';
import { ProfileLinks } from './profile-links';
import { QuoteCta } from './quote-cta';

const REVALIDATE_SECONDS = 300;

const DESCRIPTION_MAX_LENGTH = 160;

// No page-level `export const revalidate`: this page reads headers() for
// the CSP nonce, and Next rejects a segment that both declares a static
// revalidate window and calls a Dynamic API. Each `api.GET` call below sets
// its own `next.revalidate` instead, which is what gives this route "ISR".
export function generateStaticParams() {
  return [];
}

export const loadProfile = cache(async (slug: string) => {
  const [profileResult, productsResult] = await Promise.all([
    api.GET('/v1/photographers/{slug}', {
      params: { path: { slug } },
      next: { revalidate: REVALIDATE_SECONDS },
    }),
    api.GET('/v1/photographers/{slug}/products', {
      params: { path: { slug } },
      next: { revalidate: REVALIDATE_SECONDS },
    }),
  ]);

  if (profileResult.response.status === 404 || productsResult.response.status === 404) {
    return null;
  }
  if (!profileResult.data) {
    throw new Error(
      `Failed to load photographer profile "${slug}": HTTP ${String(profileResult.response.status)}`,
    );
  }
  if (!productsResult.data) {
    throw new Error(
      `Failed to load products for photographer "${slug}": HTTP ${String(productsResult.response.status)}`,
    );
  }

  return { profile: profileResult.data, products: productsResult.data };
});

function profileUrl(locale: Locale, slug: string): string {
  return `${env.NEXT_PUBLIC_SITE_URL}/${locale}/photographers/${slug}`;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> {
  const { locale: requestedLocale, slug } = await params;
  if (!isLocale(requestedLocale)) {
    return {};
  }
  const locale: Locale = requestedLocale;

  if (isCountrySegment(slug)) {
    return generateCountryLandingMetadata({ locale, countryCode: slug.toUpperCase() });
  }

  const result = await loadProfile(slug);
  if (!result) {
    return {};
  }
  const { profile } = result;

  const t = await getTranslations({ locale, namespace: 'web.profile' });
  const bio = resolveLocalizedText(profile.bio, locale)?.text ?? null;
  const description =
    profile.headline ?? (bio ? truncateAtWordBoundary(bio, DESCRIPTION_MAX_LENGTH) : undefined);

  return {
    title: t('metaTitle', { displayName: profile.displayName, city: profile.city }),
    description,
    robots: buildRobotsMetadata(env.NEXT_PUBLIC_ALLOW_INDEXING),
    alternates: {
      canonical: profileUrl(locale, slug),
      languages: {
        ...Object.fromEntries(
          SUPPORTED_LOCALES.map((supported) => [supported, profileUrl(supported, slug)]),
        ),
        'x-default': profileUrl(DEFAULT_LOCALE, slug),
      },
    },
    openGraph: {
      type: 'profile',
      title: profile.displayName,
      description,
      url: profileUrl(locale, slug),
      locale,
    },
  };
}

export default async function PhotographerProfilePage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale: requestedLocale, slug } = await params;
  if (!isLocale(requestedLocale)) {
    notFound();
  }
  const locale: Locale = requestedLocale;

  if (isCountrySegment(slug)) {
    return <CountryLandingPage locale={locale} countryCode={slug.toUpperCase()} />;
  }

  const [result, headersList] = await Promise.all([loadProfile(slug), headers()]);
  if (!result) {
    notFound();
  }
  const { profile, products } = result;

  const nonce = headersList.get('x-nonce');
  const jsonLd = buildProfileJsonLd({
    profile,
    products,
    locale,
    url: profileUrl(locale, slug),
  });

  const ctaHref = `/${locale}/requests/new?photographer=${encodeURIComponent(slug)}`;

  return (
    <article className="mx-auto flex max-w-5xl flex-col gap-12 px-4 py-12">
      <script
        type="application/ld+json"
        nonce={nonce ?? undefined}
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
      />
      <ProfileHeader profile={profile} locale={locale} />
      <ProfileBio bio={profile.bio} locale={locale} />
      <PortfolioGrid images={profile.portfolio} displayName={profile.displayName} locale={locale} />
      <ProductList products={products} locale={locale} />
      <ProfileLinks links={profile.links} locale={locale} />
      <QuoteCta href={ctaHref} locale={locale} />
    </article>
  );
}
