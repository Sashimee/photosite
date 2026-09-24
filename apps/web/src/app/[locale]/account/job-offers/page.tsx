import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { isLocale, type Locale } from '@photoo/shared';

import { StatusBadge } from '@/components/requests/status-badge';
import { FormNotice } from '@/components/ui/form-message';
import { FormattedDateTime } from '@/components/requests/formatted-date-time';
import { countryDisplayName } from '@/lib/country-name';
import { formatMoney, requireMoney } from '@/lib/money';
import { buildRobotsMetadata } from '@/lib/robots';
import { getSession, serverApi } from '@/lib/session';

import { CloseJobOfferAction } from './close-job-offer-action';
import { DeleteJobOfferAction } from './delete-job-offer-action';
import { PublishJobOfferAction } from './publish-job-offer-action';

const JOB_OFFERS_FEED_LIMIT = 20;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) {
    return {};
  }
  const t = await getTranslations({ locale, namespace: 'web.jobOffers' });
  return { title: t('metaTitle'), robots: buildRobotsMetadata(false) };
}

export default async function JobOffersPage({
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
  const signInHref = `/${locale}/sign-in?next=${encodeURIComponent(`/${locale}/account/job-offers`)}`;

  const user = await getSession();
  if (!user) {
    redirect(signInHref);
  }
  const api = await serverApi();

  const t = await getTranslations({ locale, namespace: 'web.jobOffers' });
  const tCategories = await getTranslations({ locale, namespace: 'common.categories' });
  const tStatus = await getTranslations({ locale, namespace: 'web.jobOffers.status' });

  const profileResult = await api.GET('/v1/me/professional-profile', { cache: 'no-store' });
  if (profileResult.response.status === 401) {
    redirect(signInHref);
  }
  // A 403 (no `professional` role at all) and a 404 (role but no profile row)
  // both mean "no profile yet" here - same "profile, not role" rule as
  // `/account/professional-profile` itself (docs/steps/1B.9-professional-area.md).
  if (
    profileResult.response.status !== 200 &&
    profileResult.response.status !== 403 &&
    profileResult.response.status !== 404
  ) {
    throw new Error(
      `Failed to load the professional profile: HTTP ${String(profileResult.response.status)}`,
    );
  }

  const backLink = (
    <Link
      href={`/${locale}/account`}
      className="self-start text-sm font-medium text-primary underline-offset-4 hover:underline"
    >
      {t('backToAccount')}
    </Link>
  );

  if (!profileResult.data) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-8 px-4 py-16">
        {backLink}
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold text-foreground">{t('needsProfileTitle')}</h1>
        </div>
        <FormNotice tone="info">
          <p>{t('needsProfileDescription')}</p>
          <p>
            <Link
              href={`/${locale}/account/professional-profile`}
              className="font-medium underline underline-offset-4"
            >
              {t('needsProfileCta')}
            </Link>
          </p>
        </FormNotice>
      </div>
    );
  }

  const feedResult = await api.GET('/v1/me/job-offers', {
    params: { query: { limit: JOB_OFFERS_FEED_LIMIT, ...(cursor ? { cursor } : {}) } },
    cache: 'no-store',
  });
  if (feedResult.response.status === 401) {
    redirect(signInHref);
  }
  if (!feedResult.data) {
    throw new Error(`Failed to load job offers: HTTP ${String(feedResult.response.status)}`);
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8 px-4 py-16">
      {backLink}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold text-foreground">{t('title')}</h1>
          <p className="text-muted-foreground">{t('intro')}</p>
        </div>
        <Link
          href={`/${locale}/account/job-offers/new`}
          className="self-start text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          {t('newCta')}
        </Link>
      </div>

      {feedResult.data.items.length === 0 ? (
        <p className="text-muted-foreground">{t('empty')}</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {feedResult.data.items.map((offer) => (
            <li key={offer.id} className="flex flex-col gap-3 rounded-lg border border-border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-foreground">{offer.title}</span>
                <StatusBadge label={tStatus(offer.status)} muted={offer.status !== 'published'} />
              </div>
              <p className="text-sm text-muted-foreground">
                {tCategories(offer.category)}
                {' · '}
                {offer.remote
                  ? `${t('remoteLabel')} (${offer.city}, ${countryDisplayName(offer.countryCode, locale)})`
                  : `${offer.city}, ${countryDisplayName(offer.countryCode, locale)}`}
              </p>
              {offer.compensation ? (
                <p className="text-sm text-muted-foreground">
                  {t('compensationRange', {
                    min: formatMoney(
                      requireMoney(
                        offer.compensation.min,
                        `job offer "${offer.id}" compensation min`,
                      ),
                      locale,
                    ),
                    max: formatMoney(
                      requireMoney(
                        offer.compensation.max,
                        `job offer "${offer.id}" compensation max`,
                      ),
                      locale,
                    ),
                  })}
                </p>
              ) : null}
              {offer.startDate ? (
                <p className="text-sm text-muted-foreground">
                  <FormattedDateTime value={offer.startDate} locale={locale} />
                  {offer.endDate ? (
                    <>
                      {' – '}
                      <FormattedDateTime value={offer.endDate} locale={locale} />
                    </>
                  ) : null}
                </p>
              ) : null}
              <div className="flex flex-wrap items-center gap-3">
                <Link
                  href={`/${locale}/account/job-offers/${offer.id}/edit`}
                  className="text-sm font-medium text-primary underline-offset-4 hover:underline"
                >
                  {t('editCta')}
                </Link>
                <PublishJobOfferAction jobOfferId={offer.id} status={offer.status} />
                <CloseJobOfferAction jobOfferId={offer.id} status={offer.status} />
                <DeleteJobOfferAction jobOfferId={offer.id} />
              </div>
            </li>
          ))}
        </ul>
      )}

      {feedResult.data.nextCursor ? (
        <Link
          href={`/${locale}/account/job-offers?cursor=${encodeURIComponent(feedResult.data.nextCursor)}`}
          className="self-center text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          {t('loadMore')}
        </Link>
      ) : null}
    </div>
  );
}
