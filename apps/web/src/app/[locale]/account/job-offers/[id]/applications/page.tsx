import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import Image from 'next/image';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { isLocale, type Locale } from '@photoo/shared';

import { StatusBadge } from '@/components/requests/status-badge';
import { FormattedDateTime } from '@/components/requests/formatted-date-time';
import { buildRobotsMetadata } from '@/lib/robots';
import { getSession, serverApi } from '@/lib/session';

import { RejectApplicationAction } from './reject-application-action';
import { ShortlistApplicationAction } from './shortlist-application-action';

const APPLICATIONS_FEED_LIMIT = 20;
const AVATAR_SIZE = 48;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) {
    return {};
  }
  const t = await getTranslations({ locale, namespace: 'web.jobApplications.inbox' });
  return { title: t('metaTitle'), robots: buildRobotsMetadata(false) };
}

export default async function JobOfferApplicationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ cursor?: string }>;
}) {
  const { locale: requestedLocale, id } = await params;
  if (!isLocale(requestedLocale)) {
    notFound();
  }
  const locale: Locale = requestedLocale;
  const { cursor } = await searchParams;
  const applicationsPath = `/${locale}/account/job-offers/${id}/applications`;
  const signInHref = `/${locale}/sign-in?next=${encodeURIComponent(applicationsPath)}`;

  const user = await getSession();
  if (!user) {
    redirect(signInHref);
  }
  const api = await serverApi();

  const t = await getTranslations({ locale, namespace: 'web.jobApplications.inbox' });
  const tStatus = await getTranslations({ locale, namespace: 'web.jobApplications.status' });

  const jobOfferResult = await api.GET('/v1/me/job-offers/{id}', {
    params: { path: { id } },
    cache: 'no-store',
  });
  if (jobOfferResult.response.status === 401) {
    redirect(signInHref);
  }
  // Both "no professional role at all" (403) and "not this professional's
  // offer, or it never existed" (404) are indistinguishable from the
  // outside, so both render the same not-found page rather than leaking
  // which one it was (docs/steps/1B.9-professional-area.md).
  if (jobOfferResult.response.status === 403 || jobOfferResult.response.status === 404) {
    notFound();
  }
  if (!jobOfferResult.data) {
    throw new Error(`Failed to load the job offer: HTTP ${String(jobOfferResult.response.status)}`);
  }
  const jobOffer = jobOfferResult.data;

  const feedResult = await api.GET('/v1/job-offers/{id}/applications', {
    params: {
      path: { id },
      query: { limit: APPLICATIONS_FEED_LIMIT, ...(cursor ? { cursor } : {}) },
    },
    cache: 'no-store',
  });
  if (feedResult.response.status === 401) {
    redirect(signInHref);
  }
  if (feedResult.response.status === 403 || feedResult.response.status === 404) {
    notFound();
  }
  if (!feedResult.data) {
    throw new Error(`Failed to load applications: HTTP ${String(feedResult.response.status)}`);
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8 px-4 py-16">
      <Link
        href={`/${locale}/account/job-offers`}
        className="self-start text-sm font-medium text-primary underline-offset-4 hover:underline"
      >
        {t('backToList')}
      </Link>
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold text-foreground">
          {t('title', { title: jobOffer.title })}
        </h1>
        <p className="text-muted-foreground">{t('intro')}</p>
      </div>

      {feedResult.data.items.length === 0 ? (
        <p className="text-muted-foreground">{t('empty')}</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {feedResult.data.items.map((application) => (
            <li
              key={application.id}
              className="flex flex-col gap-3 rounded-lg border border-border p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Link
                  href={`/${locale}/photographers/${application.photographer.slug}`}
                  className="flex items-center gap-3"
                >
                  {application.photographer.avatarUrl ? (
                    <Image
                      src={application.photographer.avatarUrl}
                      alt={application.photographer.displayName}
                      width={AVATAR_SIZE}
                      height={AVATAR_SIZE}
                      className="size-12 shrink-0 rounded-full object-cover"
                    />
                  ) : (
                    <div className="size-12 shrink-0 rounded-full bg-muted" aria-hidden="true" />
                  )}
                  <div className="flex flex-col gap-0.5">
                    <span className="font-medium text-foreground">
                      {application.photographer.displayName}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {application.photographer.city}
                    </span>
                  </div>
                </Link>
                <StatusBadge
                  label={tStatus(application.status)}
                  muted={application.status !== 'submitted'}
                />
              </div>

              <p className="whitespace-pre-line text-sm text-foreground">{application.message}</p>

              {application.portfolioLink ? (
                <a
                  href={application.portfolioLink}
                  target="_blank"
                  rel="nofollow noopener"
                  className="self-start text-sm text-primary underline-offset-4 hover:underline"
                >
                  {t('portfolioLinkLabel')}
                </a>
              ) : null}

              <p className="text-sm text-muted-foreground">
                <FormattedDateTime value={application.createdAt} locale={locale} />
              </p>

              <div className="flex flex-wrap items-center gap-3">
                <ShortlistApplicationAction
                  applicationId={application.id}
                  status={application.status}
                />
                <RejectApplicationAction
                  applicationId={application.id}
                  status={application.status}
                />
              </div>
            </li>
          ))}
        </ul>
      )}

      {feedResult.data.nextCursor ? (
        <Link
          href={`${applicationsPath}?cursor=${encodeURIComponent(feedResult.data.nextCursor)}`}
          className="self-center text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          {t('loadMore')}
        </Link>
      ) : null}
    </div>
  );
}
