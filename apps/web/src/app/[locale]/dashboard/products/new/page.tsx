import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { isLocale, type Locale } from '@photoo/shared';

import { FormNotice } from '@/components/ui/form-message';
import { buildRobotsMetadata } from '@/lib/robots';
import { getSession, serverApi } from '@/lib/session';

import { ProductForm } from '../product-form';

const COUNTRIES_REVALIDATE_SECONDS = 3600;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) {
    return {};
  }
  const t = await getTranslations({ locale, namespace: 'web.dashboard.products.form' });
  return { title: t('createTitle'), robots: buildRobotsMetadata(false) };
}

export default async function NewProductPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: requestedLocale } = await params;
  if (!isLocale(requestedLocale)) {
    notFound();
  }
  const locale: Locale = requestedLocale;
  const signInHref = `/${locale}/sign-in?next=${encodeURIComponent(`/${locale}/dashboard/products/new`)}`;

  const user = await getSession();
  if (!user) {
    redirect(signInHref);
  }
  const api = await serverApi();

  const [t, tProducts, profileResult, countriesResult] = await Promise.all([
    getTranslations({ locale, namespace: 'web.dashboard.products.form' }),
    getTranslations({ locale, namespace: 'web.dashboard.products' }),
    api.GET('/v1/me/photographer-profile', { cache: 'no-store' }),
    api.GET('/v1/countries', { next: { revalidate: COUNTRIES_REVALIDATE_SECONDS } }),
  ]);

  if (profileResult.response.status === 401) {
    redirect(signInHref);
  }
  if (profileResult.response.status !== 200 && profileResult.response.status !== 404) {
    throw new Error(
      `Failed to load the photographer profile: HTTP ${String(profileResult.response.status)}`,
    );
  }
  if (!countriesResult.data) {
    throw new Error(`Failed to load countries: HTTP ${String(countriesResult.response.status)}`);
  }

  if (!profileResult.data) {
    return (
      <div className="flex flex-col gap-8">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold text-foreground">
            {tProducts('needsProfileTitle')}
          </h1>
        </div>
        <FormNotice tone="info">
          <p>{tProducts('needsProfileDescription')}</p>
          <p>
            <Link
              href={`/${locale}/dashboard/profile`}
              className="font-medium underline underline-offset-4"
            >
              {tProducts('needsProfileCta')}
            </Link>
          </p>
        </FormNotice>
      </div>
    );
  }

  const currency = countriesResult.data.find(
    (country) => country.code === profileResult.data.countryCode,
  )?.currency;
  if (!currency) {
    throw new Error(`Profile country "${profileResult.data.countryCode}" has no known currency`);
  }

  return (
    <div className="flex flex-col gap-8">
      <Link
        href={`/${locale}/dashboard/products`}
        className="self-start text-sm font-medium text-primary underline-offset-4 hover:underline"
      >
        {t('backToList')}
      </Link>
      <h1 className="text-2xl font-semibold text-foreground">{t('createTitle')}</h1>
      <ProductForm locale={locale} existing={null} currency={currency} />
    </div>
  );
}
