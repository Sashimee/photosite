import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { isLocale, SUPPORTED_LOCALES, type Locale } from '@photoo/shared';

import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';
import { SkipLink } from '@/components/skip-link';
import { env } from '@/lib/env';
import { buildRobotsMetadata } from '@/lib/robots';
import '@/styles/globals.css';

export const dynamic = 'force-dynamic';

export function generateStaticParams() {
  return SUPPORTED_LOCALES.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) {
    return {};
  }

  const t = await getTranslations({ locale, namespace: 'web.home' });

  return {
    metadataBase: new URL(env.NEXT_PUBLIC_SITE_URL),
    title: t('heroTitle'),
    description: t('heroSubtitle'),
    robots: buildRobotsMetadata(env.NEXT_PUBLIC_ALLOW_INDEXING),
    alternates: {
      languages: Object.fromEntries(
        SUPPORTED_LOCALES.map((supported) => [supported, `/${supported}`]),
      ),
    },
  };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale: requestedLocale } = await params;
  if (!isLocale(requestedLocale)) {
    notFound();
  }
  const locale: Locale = requestedLocale;

  const [messages, tWeb] = await Promise.all([
    getMessages({ locale }),
    getTranslations({ locale, namespace: 'web' }),
  ]);

  return (
    <html lang={locale}>
      <body>
        <NextIntlClientProvider locale={locale} messages={messages}>
          <SkipLink label={tWeb('skipToContent')} />
          <SiteHeader locale={locale} />
          <main id="main-content">{children}</main>
          <SiteFooter locale={locale} />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
