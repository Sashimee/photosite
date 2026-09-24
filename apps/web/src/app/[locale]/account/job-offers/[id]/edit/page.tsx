import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { isLocale, type Locale } from '@photoo/shared';

import { StatusBadge } from '@/components/requests/status-badge';
import { FormNotice } from '@/components/ui/form-message';
import { buildRobotsMetadata } from '@/lib/robots';
import { getSession, serverApi } from '@/lib/session';

import { CloseJobOfferAction } from '../../close-job-offer-action';
import { DeleteJobOfferAction } from '../../delete-job-offer-action';
import { JobOfferForm } from '../../job-offer-form';
import { PublishJobOfferAction } from '../../publish-job-offer-action';

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
  return { title: t('editTitle'), robots: buildRobotsMetadata(false) };
}

export default async function EditJobOfferPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale: requestedLocale, id } = await params;
  if (!isLocale(requestedLocale)) {
    notFound();
  }
  const locale: Locale = requestedLocale;
  const signInHref = `/${locale}/sign-in?next=${encodeURIComponent(`/${locale}/account/job-offers/${id}/edit`)}`;

  const user = await getSession();
  if (!user) {
    redirect(signInHref);
  }
  const api = await serverApi();

  const [t, tJobOffers, tStatus, profileResult, jobOfferResult, countriesResult] =
    await Promise.all([
      getTranslations({ locale, namespace: 'web.jobOffers.form' }),
      getTranslations({ locale, namespace: 'web.jobOffers' }),
      getTranslations({ locale, namespace: 'web.jobOffers.status' }),
      api.GET('/v1/me/professional-profile', { cache: 'no-store' }),
      api.GET('/v1/me/job-offers/{id}', { params: { path: { id } }, cache: 'no-store' }),
      api.GET('/v1/countries', { next: { revalidate: COUNTRIES_REVALIDATE_SECONDS } }),
    ]);

  if (profileResult.response.status === 401 || jobOfferResult.response.status === 401) {
    redirect(signInHref);
  }
  if (jobOfferResult.response.status === 404) {
    notFound();
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
  if (!jobOfferResult.data) {
    throw new Error(`Failed to load the job offer: HTTP ${String(jobOfferResult.response.status)}`);
  }
  if (!countriesResult.data) {
    throw new Error(`Failed to load countries: HTTP ${String(countriesResult.response.status)}`);
  }

  const jobOffer = jobOfferResult.data;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8 px-4 py-16">
      <Link
        href={`/${locale}/account/job-offers`}
        className="self-start text-sm font-medium text-primary underline-offset-4 hover:underline"
      >
        {t('backToList')}
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold text-foreground">{t('editTitle')}</h1>
          <StatusBadge label={tStatus(jobOffer.status)} muted={jobOffer.status !== 'published'} />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <PublishJobOfferAction jobOfferId={jobOffer.id} status={jobOffer.status} />
          <CloseJobOfferAction jobOfferId={jobOffer.id} status={jobOffer.status} />
          <DeleteJobOfferAction
            jobOfferId={jobOffer.id}
            redirectTo={`/${locale}/account/job-offers`}
          />
        </div>
      </div>
      <JobOfferForm existing={jobOffer} countries={countriesResult.data} />
    </div>
  );
}
