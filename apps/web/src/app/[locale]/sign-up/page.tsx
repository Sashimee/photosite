import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';

import { isLocale, type Locale } from '@photoo/shared';

import { getSession } from '@/lib/session';
import { sanitizeNextPath } from '@/lib/next-param';

import { SignUpForm } from './sign-up-form';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) {
    return {};
  }
  const t = await getTranslations({ locale, namespace: 'web.auth.signUp' });
  return { title: t('title') };
}

export default async function SignUpPage({
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

  const user = await getSession();
  if (user) {
    const { next } = await searchParams;
    redirect(sanitizeNextPath(next, `/${locale}/account`));
  }

  return <SignUpForm locale={locale} />;
}
