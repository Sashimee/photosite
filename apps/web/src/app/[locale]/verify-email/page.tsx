import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { isLocale, type Locale } from '@photoo/shared';

import { buildRobotsMetadata } from '@/lib/robots';
import { absoluteUrl, localeAlternates } from '@/lib/site-url';

import { VerifyEmailClient } from './verify-email-client';

const VERIFY_EMAIL_PATH = '/verify-email';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) {
    return {};
  }
  const t = await getTranslations({ locale, namespace: 'web.auth.verifyEmail' });
  return {
    title: t('title'),
    robots: buildRobotsMetadata(false),
    alternates: {
      canonical: absoluteUrl(locale, VERIFY_EMAIL_PATH),
      languages: localeAlternates(VERIFY_EMAIL_PATH),
    },
  };
}

export default async function VerifyEmailPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: requestedLocale } = await params;
  if (!isLocale(requestedLocale)) {
    notFound();
  }
  const locale: Locale = requestedLocale;

  return <VerifyEmailClient locale={locale} />;
}
