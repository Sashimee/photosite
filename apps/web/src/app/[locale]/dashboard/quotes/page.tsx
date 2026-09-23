import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { isLocale, type Locale } from '@photoo/shared';

import { FormattedDateTime } from '@/components/requests/formatted-date-time';
import { isTerminalQuoteStatus, StatusBadge } from '@/components/requests/status-badge';
import { formatMoney, payoutAmount, requireMoney } from '@/lib/money';
import { buildRobotsMetadata } from '@/lib/robots';
import { getSession, serverApi } from '@/lib/session';

const DASHBOARD_QUOTES_LIMIT = 20;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) {
    return {};
  }
  const t = await getTranslations({ locale, namespace: 'web.dashboard.quotes' });
  return { title: t('metaTitle'), robots: buildRobotsMetadata(false) };
}

export default async function DashboardQuotesPage({
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
  const signInHref = `/${locale}/sign-in?next=${encodeURIComponent(`/${locale}/dashboard/quotes`)}`;

  const user = await getSession();
  if (!user) {
    redirect(signInHref);
  }
  const api = await serverApi();

  const [t, tStatus, result] = await Promise.all([
    getTranslations({ locale, namespace: 'web.dashboard.quotes' }),
    getTranslations({ locale, namespace: 'web.quotes.status' }),
    api.GET('/v1/quotes/mine', {
      params: {
        query: {
          role: 'photographer',
          limit: DASHBOARD_QUOTES_LIMIT,
          ...(cursor ? { cursor } : {}),
        },
      },
      cache: 'no-store',
    }),
  ]);

  if (result.response.status === 401) {
    redirect(signInHref);
  }
  if (!result.data) {
    throw new Error(`Failed to load your quotes: HTTP ${String(result.response.status)}`);
  }

  return (
    <div className="flex flex-col gap-8">
      <Link
        href={`/${locale}/dashboard`}
        className="self-start text-sm font-medium text-primary underline-offset-4 hover:underline"
      >
        {t('backToOverview')}
      </Link>
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold text-foreground">{t('title')}</h1>
        <p className="text-muted-foreground">{t('intro')}</p>
      </div>

      {result.data.items.length === 0 ? (
        <p className="text-muted-foreground">{t('empty')}</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {result.data.items.map((quote) => {
            const total = requireMoney(quote.total, `quote "${quote.id}" total`);
            const payout = payoutAmount(
              requireMoney(quote.subtotal, `quote "${quote.id}" subtotal`),
              requireMoney(quote.platformFee, `quote "${quote.id}" platform fee`),
            );
            return (
              <li key={quote.id} className="rounded-lg border border-border p-4">
                <Link href={`/${locale}/quotes/${quote.id}`} className="flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <StatusBadge
                      label={tStatus(quote.status)}
                      muted={isTerminalQuoteStatus(quote.status)}
                    />
                    <span className="font-medium text-foreground">
                      {formatMoney(total, locale)}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {t('payoutLabel')} {formatMoney(payout, locale)}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {t('validUntilLabel')}{' '}
                    <FormattedDateTime value={quote.validUntil} locale={locale} timeStyle="short" />
                  </p>
                  {quote.message ? (
                    <p className="text-sm text-foreground">{quote.message}</p>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {result.data.nextCursor ? (
        <Link
          href={`/${locale}/dashboard/quotes?cursor=${encodeURIComponent(result.data.nextCursor)}`}
          className="self-center text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          {t('loadMore')}
        </Link>
      ) : null}
    </div>
  );
}
