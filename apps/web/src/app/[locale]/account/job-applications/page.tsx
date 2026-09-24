import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { isLocale, type Locale } from '@photoo/shared';

import { StatusBadge } from '@/components/requests/status-badge';
import { FormattedDateTime } from '@/components/requests/formatted-date-time';
import { buildRobotsMetadata } from '@/lib/robots';
import { getSession, serverApi } from '@/lib/session';

import { WithdrawApplicationAction } from './withdraw-application-action';

const APPLICATIONS_FEED_LIMIT = 20;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) {
    return {};
  }
  const t = await getTranslations({ locale, namespace: 'web.jobApplications.mine' });
  return { title: t('metaTitle'), robots: buildRobotsMetadata(false) };
}

export default async function JobApplicationsPage({
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
  const path = `/${locale}/account/job-applications`;
  const signInHref = `/${locale}/sign-in?next=${encodeURIComponent(path)}`;

  const user = await getSession();
  if (!user) {
    redirect(signInHref);
  }
  const api = await serverApi();

  const t = await getTranslations({ locale, namespace: 'web.jobApplications.mine' });
  const tStatus = await getTranslations({ locale, namespace: 'web.jobApplications.status' });

  const feedResult = await api.GET('/v1/me/job-applications', {
    params: { query: { limit: APPLICATIONS_FEED_LIMIT, ...(cursor ? { cursor } : {}) } },
    cache: 'no-store',
  });
  if (feedResult.response.status === 401) {
    redirect(signInHref);
  }
  // A 403 here just means the account never acquired the `photographer`
  // role, which is exactly as true an "I haven't applied to anything" as a
  // 200 with zero rows - there's nothing wrong to report, so it renders the
  // same empty state rather than an error (docs/steps/1B.9-professional-area.md).
  const feed =
    feedResult.response.status === 403 ? { items: [], nextCursor: null } : feedResult.data;
  if (!feed) {
    throw new Error(`Failed to load job applications: HTTP ${String(feedResult.response.status)}`);
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8 px-4 py-16">
      <Link
        href={`/${locale}/account`}
        className="self-start text-sm font-medium text-primary underline-offset-4 hover:underline"
      >
        {t('backToAccount')}
      </Link>
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold text-foreground">{t('title')}</h1>
        <p className="text-muted-foreground">{t('intro')}</p>
      </div>

      {feed.items.length === 0 ? (
        <p className="text-muted-foreground">{t('empty')}</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {feed.items.map((application) => (
            <li
              key={application.id}
              className="flex flex-col gap-3 rounded-lg border border-border p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Link
                  href={`/${locale}/job-offers/${application.jobOffer.slug}`}
                  className="font-medium text-foreground underline-offset-4 hover:underline"
                >
                  {application.jobOffer.title}
                </Link>
                <StatusBadge
                  label={tStatus(application.status)}
                  muted={application.status !== 'submitted'}
                />
              </div>

              <p className="text-sm text-muted-foreground">
                <FormattedDateTime value={application.createdAt} locale={locale} />
              </p>

              <div className="flex flex-wrap items-center gap-3">
                <WithdrawApplicationAction
                  applicationId={application.id}
                  status={application.status}
                />
              </div>
            </li>
          ))}
        </ul>
      )}

      {feed.nextCursor ? (
        <Link
          href={`${path}?cursor=${encodeURIComponent(feed.nextCursor)}`}
          className="self-center text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          {t('loadMore')}
        </Link>
      ) : null}
    </div>
  );
}
