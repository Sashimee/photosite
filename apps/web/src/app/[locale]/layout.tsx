import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations } from 'next-intl/server';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { isLocale, SUPPORTED_LOCALES, type Locale } from '@photoo/shared';

import { ConsentBanner } from '@/components/consent/consent-banner';
import { ConsentDialog } from '@/components/consent/consent-dialog';
import { ConsentProvider } from '@/components/consent/consent-provider';
import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';
import { SkipLink } from '@/components/skip-link';
import { api } from '@/lib/api';
import { CONSENT_MODE_DEFAULT_SCRIPT } from '@/lib/consent-mode';
import { env } from '@/lib/env';
import { buildRobotsMetadata } from '@/lib/robots';
import '@/styles/globals.css';

// The published policy version is public and has no per-visitor state, so
// fetching it here (rather than from the client) lets a policy bump
// re-prompt without an extra client round-trip. A network failure must not
// take the whole site down: `null` degrades to "nothing published yet",
// which already shows the banner (docs/steps/1B.10-consent.md). The signal
// bounds a stalled connection (accepted but never answered) the same way -
// without it, this `await` blocks the entire page render indefinitely,
// since fetch has no default timeout of its own.
async function currentPolicyVersion(): Promise<string | null> {
  try {
    const { data } = await api.GET('/v1/policy-version', { signal: AbortSignal.timeout(8000) });
    return data?.policyVersion ?? null;
  } catch (error) {
    console.error('Failed to load the published policy version', error);
    return null;
  }
}

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

  const [messages, tWeb, headersList, policyVersion] = await Promise.all([
    getMessages({ locale }),
    getTranslations({ locale, namespace: 'web' }),
    headers(),
    currentPolicyVersion(),
  ]);
  const nonce = headersList.get('x-nonce') ?? undefined;

  return (
    <html lang={locale}>
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: CONSENT_MODE_DEFAULT_SCRIPT }} />
      </head>
      <body>
        <NextIntlClientProvider locale={locale} messages={messages}>
          <ConsentProvider policyVersion={policyVersion}>
            <SkipLink label={tWeb('skipToContent')} />
            <SiteHeader locale={locale} />
            <main id="main-content">{children}</main>
            <SiteFooter locale={locale} />
            <ConsentBanner />
            <ConsentDialog />
          </ConsentProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
