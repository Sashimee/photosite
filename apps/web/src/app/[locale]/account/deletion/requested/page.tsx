import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { isLocale, type Locale } from '@photoo/shared';

import { buildRobotsMetadata } from '@/lib/robots';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) {
    return {};
  }
  const t = await getTranslations({ locale, namespace: 'web.account.deletionRequested' });
  return { title: t('title'), robots: buildRobotsMetadata(false) };
}

export default async function DeletionRequestedPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: requestedLocale } = await params;
  if (!isLocale(requestedLocale)) {
    notFound();
  }
  const locale: Locale = requestedLocale;
  const t = await getTranslations({ locale, namespace: 'web.account.deletionRequested' });

  return (
    <section className="mx-auto flex max-w-md flex-col gap-6 px-4 py-16">
      <h1 className="text-2xl font-semibold text-foreground">{t('title')}</h1>
      <p className="text-sm text-muted-foreground">{t('description')}</p>
      <Link href={`/${locale}`} className="font-medium underline">
        {t('homeLink')}
      </Link>
    </section>
  );
}
