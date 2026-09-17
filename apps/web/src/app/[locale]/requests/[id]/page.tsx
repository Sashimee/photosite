import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { IdSchema, isLocale, type Locale } from '@photoo/shared';

import { CancelRequestButton } from '@/components/requests/cancel-request-button';
import { FormattedDateTime } from '@/components/requests/formatted-date-time';
import { QuoteCard } from '@/components/requests/quote-card';
import { QuoteCompare } from '@/components/requests/quote-compare';
import { isTerminalRequestStatus, StatusBadge } from '@/components/requests/status-badge';
import { FormNotice } from '@/components/ui/form-message';
import { countryDisplayName } from '@/lib/country-name';
import { formatMoney } from '@/lib/money';
import { buildRobotsMetadata } from '@/lib/robots';
import { getSession, serverApi } from '@/lib/session';

const QUOTES_LIMIT = 100;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) {
    return {};
  }
  const t = await getTranslations({ locale, namespace: 'web.requests.detail' });
  return { title: t('metaTitle'), robots: buildRobotsMetadata(false) };
}

export default async function RequestDetailPage({
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
  const signInHref = `/${locale}/sign-in?next=${encodeURIComponent(`/${locale}/requests/${id}`)}`;

  const user = await getSession();
  if (!user) {
    redirect(signInHref);
  }
  const api = await serverApi();

  const [t, tStatus, tLicenceUsages, requestResult] = await Promise.all([
    getTranslations({ locale, namespace: 'web.requests.detail' }),
    getTranslations({ locale, namespace: 'web.requests.status' }),
    getTranslations({ locale, namespace: 'common.licenceUsages' }),
    api.GET('/v1/requests/{id}', { params: { path: { id } }, cache: 'no-store' }),
  ]);

  if (requestResult.response.status === 401) {
    redirect(signInHref);
  }
  if (requestResult.response.status === 404 || requestResult.response.status === 403) {
    notFound();
  }
  if (!requestResult.data) {
    throw new Error(
      `Failed to load request "${id}": HTTP ${String(requestResult.response.status)}`,
    );
  }
  const requestItem = requestResult.data;

  const quotesResult = await api.GET('/v1/requests/{requestId}/quotes', {
    params: { path: { requestId: id }, query: { limit: QUOTES_LIMIT } },
    cache: 'no-store',
  });
  if (!quotesResult.data) {
    throw new Error(
      `Failed to load quotes for request "${id}": HTTP ${String(quotesResult.response.status)}`,
    );
  }
  const quotes = quotesResult.data.items;

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-8 px-4 py-12">
      <Link
        href={`/${locale}/requests`}
        className="self-start text-sm font-medium text-primary underline-offset-4 hover:underline"
      >
        {t('backToList')}
      </Link>

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-2xl font-semibold text-foreground">{requestItem.title}</h1>
          <StatusBadge
            label={tStatus(requestItem.status)}
            muted={isTerminalRequestStatus(requestItem.status)}
          />
        </div>
        <p className="text-foreground">{requestItem.description}</p>
        <dl className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
          <div>
            <dt className="font-medium text-foreground">{t('eventDateLabel')}</dt>
            <dd>
              <FormattedDateTime value={requestItem.eventDate} locale={locale} timeStyle="short" />
            </dd>
          </div>
          <div>
            <dt className="font-medium text-foreground">{t('budgetLabel')}</dt>
            <dd>
              {formatMoney(requestItem.budgetMin, locale)}
              {' – '}
              {formatMoney(requestItem.budgetMax, locale)}
            </dd>
          </div>
          <div>
            <dt className="font-medium text-foreground">{t('usageLabel')}</dt>
            <dd>{tLicenceUsages(requestItem.usage)}</dd>
          </div>
          <div>
            <dt className="font-medium text-foreground">{t('addressLabel')}</dt>
            <dd>
              {requestItem.address.line1}
              {requestItem.address.line2 ? `, ${requestItem.address.line2}` : ''}
              {`, ${requestItem.address.postalCode} ${requestItem.address.city}`}
              {`, ${countryDisplayName(requestItem.address.countryCode, locale)}`}
            </dd>
          </div>
        </dl>

        {requestItem.status === 'cancelled' ? (
          <FormNotice tone="info">{t('cancelledNotice')}</FormNotice>
        ) : null}

        <CancelRequestButton requestId={requestItem.id} status={requestItem.status} />
      </div>

      <QuoteCompare quotes={quotes} locale={locale} currentUserId={user.id} />

      <section className="flex flex-col gap-4" aria-labelledby="quotes-heading">
        <h2 id="quotes-heading" className="text-xl font-semibold text-foreground">
          {t('quotesHeading')}
        </h2>
        {quotes.length === 0 ? (
          <p className="text-muted-foreground">{t('noQuotes')}</p>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2">
            {quotes.map((quote) => (
              <QuoteCard key={quote.id} quote={quote} locale={locale} />
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
