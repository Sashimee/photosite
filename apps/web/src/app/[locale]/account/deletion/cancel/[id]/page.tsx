import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { IdSchema, isLocale, type Locale } from '@photoo/shared';

import { buildRobotsMetadata } from '@/lib/robots';
import { absoluteUrl, localeAlternates } from '@/lib/site-url';

import { DeletionCancelClient } from './deletion-cancel-client';

function cancelPath(id: string): string {
  return `/account/deletion/cancel/${id}`;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}): Promise<Metadata> {
  const { locale, id } = await params;
  if (!isLocale(locale)) {
    return {};
  }
  const t = await getTranslations({ locale, namespace: 'web.account.deletionCancel' });
  return {
    title: t('title'),
    robots: buildRobotsMetadata(false),
    alternates: {
      canonical: absoluteUrl(locale, cancelPath(id)),
      languages: localeAlternates(cancelPath(id)),
    },
  };
}

export default async function DeletionCancelPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale: requestedLocale, id } = await params;
  if (!isLocale(requestedLocale)) {
    notFound();
  }
  const locale: Locale = requestedLocale;
  if (!IdSchema.safeParse(id).success) {
    notFound();
  }

  return <DeletionCancelClient locale={locale} id={id} />;
}
