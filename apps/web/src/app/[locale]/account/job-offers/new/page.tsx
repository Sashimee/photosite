import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { isLocale, type Locale } from '@photoo/shared';

import { FormNotice } from '@/components/ui/form-message';
import { buildRobotsMetadata } from '@/lib/robots';
import { getSession, serverApi } from '@/lib/session';

import { JobOfferForm } from '../job-offer-form';

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
  const t = await getTranslations({ locale, namespace: 'web.jobOffers.form' });
  return { title: t('createTitle'), robots: buildRobotsMetadata(false) };
}

export default async function NewJobOfferPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: requestedLocale } = await params;
  if (!isLocale(requestedLocale)) {
    notFound();
  }
  const locale: Locale = requestedLocale;
  const signInHref = `/${locale}/sign-in?next=${encodeURIComponent(`/${locale}/account/job-offers/new`)}`;

  const user = await getSession();
  if (!user) {
    redirect(signInHref);
  }
  const api = await serverApi();

  const [t, tJobOffers, profileResult, countriesResult] = await Promise.all([
    getTranslations({ locale, namespace: 'web.jobOffers.form' }),
    getTranslations({ locale, namespace: 'web.jobOffers' }),
    api.GET('/v1/me/professional-profile', { cache: 'no-store' }),
    api.GET('/v1/countries', { next: { revalidate: COUNTRIES_REVALIDATE_SECONDS } }),
  ]);

  if (profileResult.response.status === 401) {
    redirect(signInHref);
  }
  if (
    profileResult.response.status !== 200 &&
    profileResult.response.status !== 403 &&
    profileResult.response.status !== 404
  ) {
    throw new Error(
      `Failed to load the professional profile: HTTP ${String(profileResult.response.status)}`,
    );
  }
  if (!countriesResult.data) {
    throw new Error(`Failed to load countries: HTTP ${String(countriesResult.response.status)}`);
  }

  if (!profileResult.data) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-8 px-4 py-16">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold text-foreground">
            {tJobOffers('needsProfileTitle')}
          </h1>
        </div>
        <FormNotice tone="info">
          <p>{tJobOffers('needsProfileDescription')}</p>
          <p>
            <Link
              href={`/${locale}/account/professional-profile`}
              className="font-medium underline underline-offset-4"
            >
              {tJobOffers('needsProfileCta')}
            </Link>
          </p>
        </FormNotice>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8 px-4 py-16">
      <Link
        href={`/${locale}/account/job-offers`}
        className="self-start text-sm font-medium text-primary underline-offset-4 hover:underline"
      >
        {t('backToList')}
      </Link>
      <h1 className="text-2xl font-semibold text-foreground">{t('createTitle')}</h1>
      <JobOfferForm existing={null} countries={countriesResult.data} />
    </div>
  );
}
