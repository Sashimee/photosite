import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { isLocale, type Locale } from '@photoo/shared';

import { buildRobotsMetadata } from '@/lib/robots';
import { absoluteUrl, localeAlternates } from '@/lib/site-url';

import { ResetPasswordClient } from './reset-password-client';

const RESET_PASSWORD_PATH = '/reset-password';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) {
    return {};
  }
  const t = await getTranslations({ locale, namespace: 'web.auth.resetPassword' });
  return {
    title: t('title'),
    robots: buildRobotsMetadata(false),
    alternates: {
      canonical: absoluteUrl(locale, RESET_PASSWORD_PATH),
      languages: localeAlternates(RESET_PASSWORD_PATH),
    },
  };
}

export default async function ResetPasswordPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: requestedLocale } = await params;
  if (!isLocale(requestedLocale)) {
    notFound();
  }
  const locale: Locale = requestedLocale;

  return <ResetPasswordClient locale={locale} />;
}
