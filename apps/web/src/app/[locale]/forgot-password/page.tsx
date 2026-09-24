import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { isLocale } from '@photoo/shared';

import { buildRobotsMetadata } from '@/lib/robots';
import { absoluteUrl, localeAlternates } from '@/lib/site-url';

import { ForgotPasswordForm } from './forgot-password-form';

const FORGOT_PASSWORD_PATH = '/forgot-password';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) {
    return {};
  }
  const t = await getTranslations({ locale, namespace: 'web.auth.forgotPassword' });
  return {
    title: t('title'),
    robots: buildRobotsMetadata(false),
    alternates: {
      canonical: absoluteUrl(locale, FORGOT_PASSWORD_PATH),
      languages: localeAlternates(FORGOT_PASSWORD_PATH),
    },
  };
}

export default async function ForgotPasswordPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: requestedLocale } = await params;
  if (!isLocale(requestedLocale)) {
    notFound();
  }

  return <ForgotPasswordForm />;
}
