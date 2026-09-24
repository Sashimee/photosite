import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';

import { isLocale, type Locale } from '@photoo/shared';

import { buildRobotsMetadata } from '@/lib/robots';
import { getSession } from '@/lib/session';
import { sanitizeNextPath } from '@/lib/next-param';
import { absoluteUrl, localeAlternates } from '@/lib/site-url';

import { TwoFactorForm } from './two-factor-form';

const TWO_FACTOR_PATH = '/sign-in/two-factor';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) {
    return {};
  }
  const t = await getTranslations({ locale, namespace: 'web.auth.twoFactor' });
  return {
    title: t('title'),
    robots: buildRobotsMetadata(false),
    alternates: {
      canonical: absoluteUrl(locale, TWO_FACTOR_PATH),
      languages: localeAlternates(TWO_FACTOR_PATH),
    },
  };
}

export default async function TwoFactorPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ next?: string }>;
}) {
  const { locale: requestedLocale } = await params;
  if (!isLocale(requestedLocale)) {
    notFound();
  }
  const locale: Locale = requestedLocale;
  const { next } = await searchParams;

  const user = await getSession();
  if (user) {
    redirect(sanitizeNextPath(next, `/${locale}/account`));
  }

  return <TwoFactorForm locale={locale} next={next} />;
}
