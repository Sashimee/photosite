import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { isLocale, type Locale } from '@photoo/shared';

import { FormNotice } from '@/components/ui/form-message';
import { buildRobotsMetadata } from '@/lib/robots';
import { getSession, serverApi } from '@/lib/session';

import { VerificationManager } from './verification-manager';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) {
    return {};
  }
  const t = await getTranslations({ locale, namespace: 'web.dashboard.verification' });
  return { title: t('metaTitle'), robots: buildRobotsMetadata(false) };
}

export default async function DashboardVerificationPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: requestedLocale } = await params;
  if (!isLocale(requestedLocale)) {
    notFound();
  }
  const locale: Locale = requestedLocale;
  const signInHref = `/${locale}/sign-in?next=${encodeURIComponent(`/${locale}/dashboard/verification`)}`;

  const user = await getSession();
  if (!user) {
    redirect(signInHref);
  }
  const api = await serverApi();

  const t = await getTranslations({ locale, namespace: 'web.dashboard.verification' });

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

  const requirementsResult = await api.GET('/v1/countries/{code}/verification-requirements', {
    params: { path: { code: profileResult.data.countryCode } },
    cache: 'no-store',
  });
  if (requirementsResult.response.status !== 200 && requirementsResult.response.status !== 404) {
    throw new Error(
      `Failed to load verification requirements: HTTP ${String(requirementsResult.response.status)}`,
    );
  }

  if (!requirementsResult.data) {
    return (
      <div className="flex flex-col gap-8">
        {backLink}
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold text-foreground">{t('title')}</h1>
        </div>
        <FormNotice tone="info">{t('countryUnavailableDescription')}</FormNotice>
      </div>
    );
  }

  const caseResult = await api.GET('/v1/me/verification-case', { cache: 'no-store' });
  if (caseResult.response.status !== 200 && caseResult.response.status !== 404) {
    throw new Error(
      `Failed to load the verification case: HTTP ${String(caseResult.response.status)}`,
    );
  }

  return (
    <div className="flex flex-col gap-8">
      {backLink}
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold text-foreground">{t('title')}</h1>
        <p className="text-muted-foreground">{t('intro')}</p>
      </div>
      <VerificationManager
        locale={locale}
        requirements={requirementsResult.data.documents}
        initialCase={caseResult.data ?? null}
      />
    </div>
  );
}
