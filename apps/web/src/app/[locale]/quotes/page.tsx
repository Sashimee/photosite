import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { isLocale, type Locale } from '@photoo/shared';

import { QuoteCard } from '@/components/requests/quote-card';
import { buildRobotsMetadata } from '@/lib/robots';
import { getSession, serverApi } from '@/lib/session';

const QUOTES_LIST_LIMIT = 20;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) {
    return {};
  }
  const t = await getTranslations({ locale, namespace: 'web.quotes.list' });
  return { title: t('metaTitle'), robots: buildRobotsMetadata(false) };
}

export default async function QuotesListPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ cursor?: string }>;
}) {
  const { locale: requestedLocale } = await params;
  if (!isLocale(requestedLocale)) {
    notFound();
  }
  const locale: Locale = requestedLocale;
  const { cursor } = await searchParams;
  const signInHref = `/${locale}/sign-in?next=${encodeURIComponent(`/${locale}/quotes`)}`;

  const user = await getSession();
  if (!user) {
    redirect(signInHref);
  }
  const api = await serverApi();

  const [t, result] = await Promise.all([
    getTranslations({ locale, namespace: 'web.quotes.list' }),
    api.GET('/v1/quotes/mine', {
      params: {
        query: { role: 'client', limit: QUOTES_LIST_LIMIT, ...(cursor ? { cursor } : {}) },
      },
      cache: 'no-store',
    }),
  ]);

  if (result.response.status === 401) {
    redirect(signInHref);
  }
  if (!result.data) {
    throw new Error(`Failed to load quotes: HTTP ${String(result.response.status)}`);
  }

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-8 px-4 py-12">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold text-foreground">{t('title')}</h1>
        <p className="text-muted-foreground">{t('intro')}</p>
      </div>

      {result.data.items.length === 0 ? (
        <p className="text-muted-foreground">{t('empty')}</p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {result.data.items.map((quote) => (
            <QuoteCard key={quote.id} quote={quote} locale={locale} />
          ))}
        </ul>
      )}

      {result.data.nextCursor ? (
        <Link
          href={`/${locale}/quotes?cursor=${encodeURIComponent(result.data.nextCursor)}`}
          className="self-center text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          {t('loadMore')}
        </Link>
      ) : null}
    </section>
  );
}
