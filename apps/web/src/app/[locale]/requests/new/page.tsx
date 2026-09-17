import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { isLocale, SlugSchema, type Locale } from '@photoo/shared';

import { api } from '@/lib/api';
import { buildRobotsMetadata } from '@/lib/robots';
import { getSession } from '@/lib/session';

import { PhotographerPreview } from './photographer-preview';
import { RequestForm } from './request-form';

const COUNTRIES_REVALIDATE_SECONDS = 3600;

function validPhotographerSlug(value: string | undefined): string | undefined {
  return value && SlugSchema.safeParse(value).success ? value : undefined;
}

async function loadPhotographerPreview(slug: string) {
  const [profileResult, productsResult] = await Promise.all([
    api.GET('/v1/photographers/{slug}', { params: { path: { slug } }, cache: 'no-store' }),
    api.GET('/v1/photographers/{slug}/products', {
      params: { path: { slug } },
      cache: 'no-store',
    }),
  ]);
  if (!profileResult.data || !productsResult.data) {
    return null;
  }
  return { slug, profile: profileResult.data, products: productsResult.data };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) {
    return {};
  }
  const t = await getTranslations({ locale, namespace: 'web.requests.new' });
  return { title: t('metaTitle'), robots: buildRobotsMetadata(false) };
}

export default async function NewRequestPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ photographer?: string }>;
}) {
  const { locale: requestedLocale } = await params;
  if (!isLocale(requestedLocale)) {
    notFound();
  }
  const locale: Locale = requestedLocale;
  const photographer = validPhotographerSlug((await searchParams).photographer);

  const user = await getSession();
  if (!user) {
    const next = `/${locale}/requests/new${photographer ? `?photographer=${encodeURIComponent(photographer)}` : ''}`;
    redirect(`/${locale}/sign-in?next=${encodeURIComponent(next)}`);
  }

  const [t, countriesResult, preview] = await Promise.all([
    getTranslations({ locale, namespace: 'web.requests.new' }),
    api.GET('/v1/countries', { next: { revalidate: COUNTRIES_REVALIDATE_SECONDS } }),
    photographer ? loadPhotographerPreview(photographer) : Promise.resolve(null),
  ]);

  if (!countriesResult.data) {
    throw new Error(`Failed to load countries: HTTP ${String(countriesResult.response.status)}`);
  }

  return (
    <section className="mx-auto flex max-w-2xl flex-col gap-10 px-4 py-12">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold text-foreground">{t('title')}</h1>
        <p className="text-muted-foreground">{t('intro')}</p>
      </div>

      {preview ? (
        <div className="flex flex-col gap-4">
          <Link
            href={`/${locale}/photographers/${preview.slug}`}
            className="self-start text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            {t('backToProfile')}
          </Link>
          <PhotographerPreview
            profile={preview.profile}
            products={preview.products}
            slug={preview.slug}
            locale={locale}
          />
        </div>
      ) : null}

      <RequestForm locale={locale} countries={countriesResult.data} />
    </section>
  );
}
