import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';

import { isLocale, type Locale } from '@photoo/shared';

import { buildRobotsMetadata } from '@/lib/robots';
import { getSession } from '@/lib/session';
import { sanitizeNextPath } from '@/lib/next-param';
import { absoluteUrl, localeAlternates } from '@/lib/site-url';

import { SignUpForm } from './sign-up-form';

const SIGN_UP_PATH = '/sign-up';

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
  return {
    title: t('title'),
    // Noindexed like the rest of the auth flow (see sign-in/page.tsx), but a
    // stable canonical + hreflang set still matters here: sign-up is where
    // ads campaigns land visitors, and UTM params on the query string must
    // survive onto this URL regardless of indexing status.
    robots: buildRobotsMetadata(false),
    alternates: {
      canonical: absoluteUrl(locale, SIGN_UP_PATH),
      languages: localeAlternates(SIGN_UP_PATH),
    },
  };
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
