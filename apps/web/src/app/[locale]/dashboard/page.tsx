import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { isLocale, type Locale } from '@photoo/shared';

import { StatusBadge } from '@/components/requests/status-badge';
import { FormNotice } from '@/components/ui/form-message';
import { buildRobotsMetadata } from '@/lib/robots';
import { getSession, serverApi } from '@/lib/session';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) {
    return {};
  }
  const t = await getTranslations({ locale, namespace: 'web.dashboard.overview' });
  return { title: t('metaTitle'), robots: buildRobotsMetadata(false) };
}

function ChecklistRow({
  title,
  status,
  statusLabel,
  description,
  action,
}: {
  title: string;
  status: 'done' | 'todo' | 'comingSoon';
  statusLabel: string;
  description: string;
  action: ReactNode;
}) {
  return (
    <li className="flex flex-col gap-2 rounded-lg border border-border p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="font-medium text-foreground">{title}</span>
          <StatusBadge label={statusLabel} muted={status !== 'done'} />
        </div>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {action}
    </li>
  );
}

export default async function DashboardOverviewPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: requestedLocale } = await params;
  if (!isLocale(requestedLocale)) {
    notFound();
  }
  const locale: Locale = requestedLocale;
  const signInHref = `/${locale}/sign-in?next=${encodeURIComponent(`/${locale}/dashboard`)}`;

  const user = await getSession();
  if (!user) {
    redirect(signInHref);
  }
  const api = await serverApi();

  const overview = await getTranslations({ locale, namespace: 'web.dashboard.overview' });

  const result = await api.GET('/v1/me/photographer-profile', { cache: 'no-store' });

  if (result.response.status === 401) {
    redirect(signInHref);
  }
  if (result.response.status !== 200 && result.response.status !== 404) {
    throw new Error(
      `Failed to load the photographer profile: HTTP ${String(result.response.status)}`,
    );
  }
  const profile = result.data ?? null;

  let hasPortfolioAndProducts = false;
  if (profile) {
    const [portfolioResult, productsResult] = await Promise.all([
      api.GET('/v1/me/photographer-profile/portfolio', {
        params: { query: { limit: 1 } },
        cache: 'no-store',
      }),
      api.GET('/v1/me/products', { cache: 'no-store' }),
    ]);
    if (!portfolioResult.data) {
      throw new Error(
        `Failed to load the portfolio: HTTP ${String(portfolioResult.response.status)}`,
      );
    }
    if (!productsResult.data) {
      throw new Error(`Failed to load packages: HTTP ${String(productsResult.response.status)}`);
    }
    hasPortfolioAndProducts =
      portfolioResult.data.items.length > 0 && productsResult.data.length > 0;
  }

  const profileHref = `/${locale}/dashboard/profile`;
  const portfolioHref = `/${locale}/dashboard/portfolio`;
  const verificationHref = `/${locale}/dashboard/verification`;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold text-foreground">{overview('title')}</h1>
        <p className="text-muted-foreground">{overview('intro')}</p>
      </div>

      {profile ? (
        <FormNotice tone={profile.isPublished ? 'success' : 'info'}>
          <p className="font-medium">
            {overview(
              profile.isPublished ? 'publication.publishedTitle' : 'publication.notPublishedTitle',
            )}
          </p>
          <p>
            {overview(
              profile.isPublished
                ? 'publication.publishedDescription'
                : 'publication.notPublishedDescription',
            )}
          </p>
        </FormNotice>
      ) : (
        <FormNotice tone="info">{overview('publication.noProfileDescription')}</FormNotice>
      )}

      <ul className="flex flex-col gap-3">
        <ChecklistRow
          title={overview('checklist.profile.title')}
          status={profile ? 'done' : 'todo'}
          statusLabel={overview(profile ? 'checklist.status.done' : 'checklist.status.todo')}
          description={overview(
            profile ? 'checklist.profile.doneDescription' : 'checklist.profile.todoDescription',
          )}
          action={
            <Link
              href={profileHref}
              className="self-start text-sm font-medium text-primary underline-offset-4 hover:underline"
            >
              {overview(profile ? 'checklist.profile.cta' : 'checklist.profile.startCta')}
            </Link>
          }
        />

        <ChecklistRow
          title={overview('checklist.portfolio.title')}
          status={profile && hasPortfolioAndProducts ? 'done' : 'todo'}
          statusLabel={overview(
            profile && hasPortfolioAndProducts ? 'checklist.status.done' : 'checklist.status.todo',
          )}
          description={overview(
            profile && hasPortfolioAndProducts
              ? 'checklist.portfolio.doneDescription'
              : 'checklist.portfolio.todoDescription',
          )}
          action={
            profile ? (
              <Link
                href={portfolioHref}
                className="self-start text-sm font-medium text-primary underline-offset-4 hover:underline"
              >
                {overview(
                  hasPortfolioAndProducts
                    ? 'checklist.portfolio.cta'
                    : 'checklist.portfolio.startCta',
                )}
              </Link>
            ) : (
              <span className="text-sm text-muted-foreground">
                {overview('checklist.portfolio.needsProfile')}
              </span>
            )
          }
        />

        <ChecklistRow
          title={overview('checklist.verification.title')}
          status={profile?.verificationStatus === 'verified' ? 'done' : 'todo'}
          statusLabel={overview(
            profile
              ? `checklist.verification.${profile.verificationStatus}`
              : 'checklist.status.todo',
          )}
          description={overview('checklist.verification.description')}
          action={
            profile ? (
              <Link
                href={verificationHref}
                className="self-start text-sm font-medium text-primary underline-offset-4 hover:underline"
              >
                {overview(
                  profile.verificationStatus === 'unverified'
                    ? 'checklist.verification.startCta'
                    : 'checklist.verification.cta',
                )}
              </Link>
            ) : (
              <span className="text-sm text-muted-foreground">
                {overview('checklist.verification.needsProfile')}
              </span>
            )
          }
        />

        <ChecklistRow
          title={overview('checklist.payouts.title')}
          status="comingSoon"
          statusLabel={overview('checklist.status.comingSoon')}
          description={overview('checklist.payouts.description')}
          action={
            <span className="text-sm text-muted-foreground">
              {overview('checklist.payouts.comingSoon')}
            </span>
          }
        />
      </ul>
    </div>
  );
}
