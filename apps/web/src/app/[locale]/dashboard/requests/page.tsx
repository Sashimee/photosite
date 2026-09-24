import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { isLocale, type Locale } from '@photoo/shared';

import { FormattedDateTime } from '@/components/requests/formatted-date-time';
import { StatusBadge } from '@/components/requests/status-badge';
import { FormNotice } from '@/components/ui/form-message';
import { countryDisplayName } from '@/lib/country-name';
import { formatMoney } from '@/lib/money';
import { buildRobotsMetadata } from '@/lib/robots';
import { getSession, serverApi } from '@/lib/session';

import { SendQuoteDialog } from './send-quote-dialog';

const REQUESTS_FEED_LIMIT = 20;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) {
    return {};
  }
  const t = await getTranslations({ locale, namespace: 'web.dashboard.requests' });
  return { title: t('metaTitle'), robots: buildRobotsMetadata(false) };
}

export default async function DashboardRequestsPage({
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
  const signInHref = `/${locale}/sign-in?next=${encodeURIComponent(`/${locale}/dashboard/requests`)}`;

  const user = await getSession();
  if (!user) {
    redirect(signInHref);
  }
  const api = await serverApi();

  const t = await getTranslations({ locale, namespace: 'web.dashboard.requests' });

  const profileResult = await api.GET('/v1/me/photographer-profile', { cache: 'no-store' });
  if (profileResult.response.status === 401) {
    redirect(signInHref);
  }
  if (profileResult.response.status !== 200 && profileResult.response.status !== 404) {
    throw new Error(
      `Failed to load the photographer profile: HTTP ${String(profileResult.response.status)}`,
    );
  }

  const backLink = (
    <Link
      href={`/${locale}/dashboard`}
      className="self-start text-sm font-medium text-primary underline-offset-4 hover:underline"
    >
      {t('backToOverview')}
    </Link>
  );

  if (!profileResult.data) {
    return (
      <div className="flex flex-col gap-8">
        {backLink}
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold text-foreground">{t('needsProfileTitle')}</h1>
        </div>
        <FormNotice tone="info">
          <p>{t('needsProfileDescription')}</p>
          <p>
            <Link
              href={`/${locale}/dashboard/profile`}
              className="font-medium underline underline-offset-4"
            >
              {t('needsProfileCta')}
            </Link>
          </p>
        </FormNotice>
      </div>
    );
  }

  if (!profileResult.data.isPublished) {
    return (
      <div className="flex flex-col gap-8">
        {backLink}
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold text-foreground">{t('needsPublishedTitle')}</h1>
        </div>
        <FormNotice tone="info">
          <p>{t('needsPublishedDescription')}</p>
          <p>
            <Link
              href={`/${locale}/dashboard`}
              className="font-medium underline underline-offset-4"
            >
              {t('needsPublishedCta')}
            </Link>
          </p>
        </FormNotice>
      </div>
    );
  }

  const [tStatus, tCategories, tLicenceUsages, feedResult] = await Promise.all([
    getTranslations({ locale, namespace: 'web.requests.status' }),
    getTranslations({ locale, namespace: 'common.categories' }),
    getTranslations({ locale, namespace: 'common.licenceUsages' }),
    api.GET('/v1/requests', {
      params: { query: { limit: REQUESTS_FEED_LIMIT, ...(cursor ? { cursor } : {}) } },
      cache: 'no-store',
    }),
  ]);

  if (feedResult.response.status === 401) {
    redirect(signInHref);
  }
  if (!feedResult.data) {
    throw new Error(`Failed to load incoming requests: HTTP ${String(feedResult.response.status)}`);
  }

  return (
    <div className="flex flex-col gap-8">
      {backLink}
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold text-foreground">{t('title')}</h1>
        <p className="text-muted-foreground">{t('intro')}</p>
      </div>

      {feedResult.data.items.length === 0 ? (
        <p className="text-muted-foreground">{t('empty')}</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {feedResult.data.items.map((item) => {
            const canQuote =
              !item.hasQuoted &&
              (item.expiresAt === null || new Date(item.expiresAt).getTime() > Date.now());
            return (
              <li key={item.id} className="flex flex-col gap-2 rounded-lg border border-border p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-foreground">{tCategories(item.category)}</span>
                  <div className="flex items-center gap-2">
                    {item.hasQuoted ? <StatusBadge label={t('alreadyQuotedLabel')} muted /> : null}
                    <StatusBadge label={tStatus(item.status)} />
                  </div>
                </div>
                <p className="text-sm text-muted-foreground">
                  <FormattedDateTime value={item.eventDate} locale={locale} timeStyle="short" />
                  {' · '}
                  {item.city}, {countryDisplayName(item.countryCode, locale)}
                </p>
                <p className="text-sm text-muted-foreground">
                  {formatMoney(item.budgetMin, locale)}
                  {' – '}
                  {formatMoney(item.budgetMax, locale)}
                  {' · '}
                  {tLicenceUsages(item.usage)}
                </p>
                <p className="text-sm text-foreground">{item.description}</p>
                {canQuote ? (
                  <SendQuoteDialog request={item} locale={locale} />
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {item.hasQuoted ? t('alreadyQuotedNotice') : t('expiredNotice')}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {feedResult.data.nextCursor ? (
        <Link
          href={`/${locale}/dashboard/requests?cursor=${encodeURIComponent(feedResult.data.nextCursor)}`}
          className="self-center text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          {t('loadMore')}
        </Link>
      ) : null}
    </div>
  );
}
