import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { isLocale, type Locale } from '@photoo/shared';

import { buildRobotsMetadata } from '@/lib/robots';
import { getSession, serverApi } from '@/lib/session';

import { DeleteProductButton } from '../delete-product-button';
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
  return { title: t('editTitle'), robots: buildRobotsMetadata(false) };
}

export default async function EditProductPage({
  params,
}: {
  params: Promise<{ locale: string; productId: string }>;
}) {
  const { locale: requestedLocale, productId } = await params;
  if (!isLocale(requestedLocale)) {
    notFound();
  }
  const locale: Locale = requestedLocale;
  const signInHref = `/${locale}/sign-in?next=${encodeURIComponent(`/${locale}/dashboard/products/${productId}`)}`;

  const user = await getSession();
  if (!user) {
    redirect(signInHref);
  }
  const api = await serverApi();

  const [t, profileResult, productResult, countriesResult] = await Promise.all([
    getTranslations({ locale, namespace: 'web.dashboard.products.form' }),
    api.GET('/v1/me/photographer-profile', { cache: 'no-store' }),
    api.GET('/v1/me/products/{productId}', {
      params: { path: { productId } },
      cache: 'no-store',
    }),
    api.GET('/v1/countries', { next: { revalidate: COUNTRIES_REVALIDATE_SECONDS } }),
  ]);

  if (profileResult.response.status === 401 || productResult.response.status === 401) {
    redirect(signInHref);
  }
  if (productResult.response.status === 404) {
    notFound();
  }
  if (!profileResult.data) {
    throw new Error(
      `Failed to load the photographer profile: HTTP ${String(profileResult.response.status)}`,
    );
  }
  if (!productResult.data) {
    throw new Error(`Failed to load the package: HTTP ${String(productResult.response.status)}`);
  }
  if (!countriesResult.data) {
    throw new Error(`Failed to load countries: HTTP ${String(countriesResult.response.status)}`);
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
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold text-foreground">{t('editTitle')}</h1>
        <DeleteProductButton
          productId={productResult.data.id}
          redirectTo={`/${locale}/dashboard/products`}
        />
      </div>
      <ProductForm locale={locale} existing={productResult.data} currency={currency} />
    </div>
  );
}
