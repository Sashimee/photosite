import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { isLocale, type Locale } from '@photoo/shared';

import { FormNotice } from '@/components/ui/form-message';
import { resolveLocalizedText } from '@/lib/localized-text';
import { formatMoney, lowestPrice, requireMoney } from '@/lib/money';
import { buildRobotsMetadata } from '@/lib/robots';
import { getSession, serverApi } from '@/lib/session';

import { DeleteProductButton } from './delete-product-button';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) {
    return {};
  }
  const t = await getTranslations({ locale, namespace: 'web.dashboard.products' });
  return { title: t('metaTitle'), robots: buildRobotsMetadata(false) };
}

export default async function DashboardProductsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: requestedLocale } = await params;
  if (!isLocale(requestedLocale)) {
    notFound();
  }
  const locale: Locale = requestedLocale;
  const signInHref = `/${locale}/sign-in?next=${encodeURIComponent(`/${locale}/dashboard/products`)}`;

  const user = await getSession();
  if (!user) {
    redirect(signInHref);
  }
  const api = await serverApi();

  const t = await getTranslations({ locale, namespace: 'web.dashboard.products' });

  const profileResult = await api.GET('/v1/me/photographer-profile', { cache: 'no-store' });
  if (profileResult.response.status === 401) {
    redirect(signInHref);
  }
  if (profileResult.response.status !== 200 && profileResult.response.status !== 404) {
    throw new Error(
      `Failed to load the photographer profile: HTTP ${String(profileResult.response.status)}`,
    );
  }

  const backLink = (
    <Link
      href={`/${locale}/dashboard`}
      className="self-start text-sm font-medium text-primary underline-offset-4 hover:underline"
    >
      {t('backToOverview')}
    </Link>
  );

  if (!profileResult.data) {
    return (
      <div className="flex flex-col gap-8">
        {backLink}
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold text-foreground">{t('needsProfileTitle')}</h1>
        </div>
        <FormNotice tone="info">
          <p>{t('needsProfileDescription')}</p>
          <p>
            <Link
              href={`/${locale}/dashboard/profile`}
              className="font-medium underline underline-offset-4"
            >
              {t('needsProfileCta')}
            </Link>
          </p>
        </FormNotice>
      </div>
    );
  }

  const productsResult = await api.GET('/v1/me/products', { cache: 'no-store' });
  if (!productsResult.data) {
    throw new Error(`Failed to load packages: HTTP ${String(productsResult.response.status)}`);
  }

  const products = [...productsResult.data].sort((a, b) => a.order - b.order);

  return (
    <div className="flex flex-col gap-8">
      {backLink}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold text-foreground">{t('title')}</h1>
          <p className="text-muted-foreground">{t('intro')}</p>
        </div>
        <Link
          href={`/${locale}/dashboard/products/new`}
          className="self-start text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          {t('newCta')}
        </Link>
      </div>

      {products.length === 0 ? (
        <p className="text-muted-foreground">{t('empty')}</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {products.map((product) => {
            const title = resolveLocalizedText(product.title, locale);
            const from = formatMoney(
              requireMoney(
                lowestPrice(product.tiers.map((tier) => tier.price)),
                `product "${product.id}"`,
              ),
              locale,
            );
            return (
              <li
                key={product.id}
                className="flex flex-col gap-2 rounded-lg border border-border p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <span
                      className="font-medium text-foreground"
                      {...(title && title.locale !== locale ? { lang: title.locale } : {})}
                    >
                      {title?.text ?? ''}
                    </span>
                    {product.isActive ? null : (
                      <span className="rounded-full border border-border px-2 py-0.5 text-xs font-medium text-muted-foreground">
                        {t('inactiveLabel')}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">{t('fromPrice', { price: from })}</p>
                </div>
                <div className="flex items-center gap-3">
                  <Link
                    href={`/${locale}/dashboard/products/${product.id}`}
                    className="text-sm font-medium text-primary underline-offset-4 hover:underline"
                  >
                    {t('editCta')}
                  </Link>
                  <DeleteProductButton productId={product.id} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
