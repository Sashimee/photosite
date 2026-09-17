import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { IdSchema, isLocale, type Locale } from '@photoo/shared';

import { FormattedDateTime } from '@/components/requests/formatted-date-time';
import { QuoteActions } from '@/components/requests/quote-actions';
import { QuoteLineItems } from '@/components/requests/quote-line-items';
import { isTerminalQuoteStatus, StatusBadge } from '@/components/requests/status-badge';
import { FormNotice } from '@/components/ui/form-message';
import { formatMoney, requireMoney } from '@/lib/money';
import { buildRobotsMetadata } from '@/lib/robots';
import { getSession, serverApi } from '@/lib/session';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) {
    return {};
  }
  const t = await getTranslations({ locale, namespace: 'web.quotes.detail' });
  return { title: t('metaTitle'), robots: buildRobotsMetadata(false) };
}

export default async function QuoteDetailPage({
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
  const signInHref = `/${locale}/sign-in?next=${encodeURIComponent(`/${locale}/quotes/${id}`)}`;

  const user = await getSession();
  if (!user) {
    redirect(signInHref);
  }
  const api = await serverApi();

  const [t, tStatus, result] = await Promise.all([
    getTranslations({ locale, namespace: 'web.quotes.detail' }),
    getTranslations({ locale, namespace: 'web.quotes.status' }),
    api.GET('/v1/quotes/{id}', { params: { path: { id } }, cache: 'no-store' }),
  ]);

  if (result.response.status === 401) {
    redirect(signInHref);
  }
  if (result.response.status === 404 || result.response.status === 403) {
    notFound();
  }
  if (!result.data) {
    throw new Error(`Failed to load quote "${id}": HTTP ${String(result.response.status)}`);
  }
  const quote = result.data;
  const total = requireMoney(quote.total, `quote "${quote.id}" total`);

  return (
    <section className="mx-auto flex max-w-2xl flex-col gap-8 px-4 py-12">
      <div className="flex flex-col gap-2">
        <Link
          href={quote.requestId ? `/${locale}/requests/${quote.requestId}` : `/${locale}/quotes`}
          className="self-start text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          {quote.requestId ? t('backToRequest') : t('backToList')}
        </Link>
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-2xl font-semibold text-foreground">{formatMoney(total, locale)}</h1>
          <StatusBadge label={tStatus(quote.status)} muted={isTerminalQuoteStatus(quote.status)} />
        </div>
        <p className="text-sm text-muted-foreground">
          {t('validUntilLabel')}{' '}
          <FormattedDateTime value={quote.validUntil} locale={locale} timeStyle="short" />
        </p>
      </div>

      {quote.status === 'accepted' ? (
        <FormNotice tone="success">{t('acceptedNotice')}</FormNotice>
      ) : null}
      {quote.status === 'declined' ? (
        <FormNotice tone="info">{t('declinedNotice')}</FormNotice>
      ) : null}

      <div className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-foreground">{t('lineItemsHeading')}</h2>
        <QuoteLineItems lineItems={quote.lineItems} currency={total.currency} locale={locale} />
        <div className="flex items-center justify-between gap-2 border-t border-border pt-2 font-medium text-foreground">
          <span>{t('totalLabel')}</span>
          <span>{formatMoney(total, locale)}</span>
        </div>
      </div>

      {quote.message ? (
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-semibold text-foreground">{t('messageHeading')}</h2>
          <p className="text-sm text-foreground">{quote.message}</p>
        </div>
      ) : null}

      <QuoteActions quote={quote} currentUserId={user.id} />
    </section>
  );
}
