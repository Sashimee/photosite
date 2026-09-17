import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { isLocale, SlugSchema, type Locale } from '@photoo/shared';

import { Button } from '@/components/ui/button';
import { getSession } from '@/lib/session';

function validPhotographerSlug(value: string | undefined): string | undefined {
  return value && SlugSchema.safeParse(value).success ? value : undefined;
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
  const t = await getTranslations({ locale, namespace: 'web.requests.placeholder' });
  return { title: t('title') };
}

export default async function NewRequestPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ photographer?: string }>;
}) {
  const { locale: requestedLocale } = await params;
  if (!isLocale(requestedLocale)) {
    notFound();
  }
  const locale: Locale = requestedLocale;
  const photographer = validPhotographerSlug((await searchParams).photographer);

  const user = await getSession();
  if (!user) {
    const next = `/${locale}/requests/new${photographer ? `?photographer=${encodeURIComponent(photographer)}` : ''}`;
    redirect(`/${locale}/sign-in?next=${encodeURIComponent(next)}`);
  }

  const t = await getTranslations({ locale, namespace: 'web.requests.placeholder' });
  const backHref = photographer ? `/${locale}/photographers/${photographer}` : `/${locale}`;

  return (
    <section className="mx-auto flex max-w-xl flex-col items-center gap-4 px-4 py-24 text-center">
      <h1 className="text-3xl font-semibold text-foreground">{t('title')}</h1>
      <p className="text-muted-foreground">{t('description')}</p>
      <Button asChild>
        <Link href={backHref}>{t('backCta')}</Link>
      </Button>
    </section>
  );
}
