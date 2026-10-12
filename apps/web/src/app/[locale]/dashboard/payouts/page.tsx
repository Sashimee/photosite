import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { isLocale, type Locale } from '@photoo/shared';

import { StatusBadge } from '@/components/requests/status-badge';
import { FormNotice } from '@/components/ui/form-message';
import { buildRobotsMetadata } from '@/lib/robots';
import { getSession, serverApi } from '@/lib/session';

import { PayoutsButton } from './payouts-button';
import { payoutsState } from './payouts-state';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) {
    return {};
  }
  const t = await getTranslations({ locale, namespace: 'web.dashboard.payouts' });
  return { title: t('metaTitle'), robots: buildRobotsMetadata(false) };
}

export default async function DashboardPayoutsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: requestedLocale } = await params;
  if (!isLocale(requestedLocale)) {
    notFound();
  }
  const locale: Locale = requestedLocale;
  const signInHref = `/${locale}/sign-in?next=${encodeURIComponent(`/${locale}/dashboard/payouts`)}`;

  const user = await getSession();
  if (!user) {
    redirect(signInHref);
  }
  const api = await serverApi();

  const t = await getTranslations({ locale, namespace: 'web.dashboard.payouts' });

  const result = await api.GET('/v1/me/photographer-profile', { cache: 'no-store' });
  if (result.response.status === 401) {
    redirect(signInHref);
  }
  if (result.response.status !== 200 && result.response.status !== 404) {
    throw new Error(
      `Failed to load the photographer profile: HTTP ${String(result.response.status)}`,
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

  if (!result.data) {
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

  const state = payoutsState(result.data);

  return (
    <div className="flex flex-col gap-8">
      {backLink}
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold text-foreground">{t('title')}</h1>
        <p className="text-muted-foreground">{t('intro')}</p>
      </div>

      <div className="flex flex-col gap-3 rounded-lg border border-border p-4">
        <div>
          <StatusBadge label={t(`status.${state}`)} muted={state !== 'enabled'} />
        </div>
        <p className="text-sm text-foreground">{t(`description.${state}`)}</p>
        {state === 'enabled' ? null : <PayoutsButton resume={state === 'incomplete'} />}
      </div>
    </div>
  );
}
