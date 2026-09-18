import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { isLocale, type Locale } from '@photoo/shared';

import { buildRobotsMetadata } from '@/lib/robots';
import { getSession, serverApi } from '@/lib/session';

import { ProfileForm } from './profile-form';

const COUNTRIES_REVALIDATE_SECONDS = 3600;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) {
    return {};
  }
  const t = await getTranslations({ locale, namespace: 'web.dashboard.profile' });
  return { title: t('metaTitle'), robots: buildRobotsMetadata(false) };
}

export default async function DashboardProfilePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: requestedLocale } = await params;
  if (!isLocale(requestedLocale)) {
    notFound();
  }
  const locale: Locale = requestedLocale;
  const signInHref = `/${locale}/sign-in?next=${encodeURIComponent(`/${locale}/dashboard/profile`)}`;

  const user = await getSession();
  if (!user) {
    redirect(signInHref);
  }
  const api = await serverApi();

  const [t, profileResult, countriesResult] = await Promise.all([
    getTranslations({ locale, namespace: 'web.dashboard.profile' }),
    api.GET('/v1/me/photographer-profile', { cache: 'no-store' }),
    api.GET('/v1/countries', { next: { revalidate: COUNTRIES_REVALIDATE_SECONDS } }),
  ]);

  if (profileResult.response.status === 401) {
    redirect(signInHref);
  }
  if (profileResult.response.status !== 200 && profileResult.response.status !== 404) {
    throw new Error(
      `Failed to load the photographer profile: HTTP ${String(profileResult.response.status)}`,
    );
  }
  if (!countriesResult.data) {
    throw new Error(`Failed to load countries: HTTP ${String(countriesResult.response.status)}`);
  }

  const existing = profileResult.data ?? null;

  return (
    <div className="flex flex-col gap-8">
      <Link
        href={`/${locale}/dashboard`}
        className="self-start text-sm font-medium text-primary underline-offset-4 hover:underline"
      >
        {t('backToOverview')}
      </Link>

      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold text-foreground">
          {t(existing ? 'editTitle' : 'createTitle')}
        </h1>
        {existing ? null : <p className="text-muted-foreground">{t('createIntro')}</p>}
      </div>

      <ProfileForm locale={locale} existing={existing} countries={countriesResult.data} />
    </div>
  );
}
