import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import type { components } from '@photoo/api-client';
import { isLocale, type Locale } from '@photoo/shared';

import { FormattedDateTime } from '@/components/requests/formatted-date-time';
import { isTerminalRequestStatus, StatusBadge } from '@/components/requests/status-badge';
import { formatMoney } from '@/lib/money';
import { buildRobotsMetadata } from '@/lib/robots';
import { getSession, serverApi } from '@/lib/session';

type RequestDto = components['schemas']['Request'];
type Api = Awaited<ReturnType<typeof serverApi>>;

const REQUESTS_LIST_LIMIT = 20;
// `Request`/`RequestSummary` carry no quote count, and a `limit: 1` probe
// can only tell us "zero" from "one or more", not a real count, so this
// stays a per-item fetch until the API adds one (#95).
const QUOTE_COUNT_LIMIT = 100;

async function loadQuoteCount(api: Api, requestId: string): Promise<number> {
  const { data } = await api.GET('/v1/requests/{requestId}/quotes', {
    params: { path: { requestId }, query: { limit: QUOTE_COUNT_LIMIT } },
    cache: 'no-store',
  });
  return data?.items.length ?? 0;
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
  const t = await getTranslations({ locale, namespace: 'web.requests.list' });
  return { title: t('metaTitle'), robots: buildRobotsMetadata(false) };
}

export default async function RequestsListPage({
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
  const signInHref = `/${locale}/sign-in?next=${encodeURIComponent(`/${locale}/requests`)}`;

  const user = await getSession();
  if (!user) {
    redirect(signInHref);
  }
  const api = await serverApi();

  const [t, tStatus, result] = await Promise.all([
    getTranslations({ locale, namespace: 'web.requests.list' }),
    getTranslations({ locale, namespace: 'web.requests.status' }),
    api.GET('/v1/requests/mine', {
      params: { query: { limit: REQUESTS_LIST_LIMIT, ...(cursor ? { cursor } : {}) } },
      cache: 'no-store',
    }),
  ]);

  if (result.response.status === 401) {
    redirect(signInHref);
  }
  if (!result.data) {
    throw new Error(`Failed to load requests: HTTP ${String(result.response.status)}`);
  }

  const quoteCounts = await Promise.all(
    result.data.items.map((item) => loadQuoteCount(api, item.id)),
  );

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-8 px-4 py-12">
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-semibold text-foreground">{t('title')}</h1>
          <p className="text-muted-foreground">{t('intro')}</p>
        </div>
        <Link
          href={`/${locale}/requests/new`}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          {t('newCta')}
        </Link>
      </div>

      {result.data.items.length === 0 ? (
        <p className="text-muted-foreground">{t('empty')}</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {result.data.items.map((item: RequestDto, index: number) => (
            <li key={item.id} className="rounded-lg border border-border p-4">
              <Link href={`/${locale}/requests/${item.id}`} className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-foreground">{item.title}</span>
                  <StatusBadge
                    label={tStatus(item.status)}
                    muted={isTerminalRequestStatus(item.status)}
                  />
                </div>
                <p className="text-sm text-muted-foreground">
                  <FormattedDateTime value={item.eventDate} locale={locale} timeStyle="short" />
                  {' · '}
                  {formatMoney(item.budgetMin, locale)}
                  {' – '}
                  {formatMoney(item.budgetMax, locale)}
                </p>
                <p className="text-sm text-muted-foreground">
                  {t('quoteCount', { count: quoteCounts[index] ?? 0 })}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {result.data.nextCursor ? (
        <Link
          href={`/${locale}/requests?cursor=${encodeURIComponent(result.data.nextCursor)}`}
          className="self-center text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          {t('loadMore')}
        </Link>
      ) : null}
    </section>
  );
}
