import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';

import { isLocale, type Locale } from '@photoo/shared';

import { buildRobotsMetadata } from '@/lib/robots';
import { getSession } from '@/lib/session';
import { sanitizeNextPath } from '@/lib/next-param';
import { absoluteUrl, localeAlternates } from '@/lib/site-url';

import { SignInForm } from './sign-in-form';

const SIGN_IN_PATH = '/sign-in';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) {
    return {};
  }
  const t = await getTranslations({ locale, namespace: 'web.auth.signIn' });
  return {
    title: t('title'),
    // A sign-in form has no unique content per visitor and duplicates across
    // every locale, so it stays out of the organic index; ads can still
    // target it directly without indexing (docs/steps/1B.11-seo.md).
    robots: buildRobotsMetadata(false),
    alternates: {
      canonical: absoluteUrl(locale, SIGN_IN_PATH),
      languages: localeAlternates(SIGN_IN_PATH),
    },
  };
}

export default async function SignInPage({
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

  return <SignInForm locale={locale} next={next} />;
}
