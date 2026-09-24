import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import Image from 'next/image';
import Link from 'next/link';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { cache } from 'react';

import { isLocale, type Locale } from '@photoo/shared';

import { EmailVerificationRequired } from '@/components/email-verification-required';
import { FormattedDateTime } from '@/components/requests/formatted-date-time';
import { StatusBadge } from '@/components/requests/status-badge';
import { api } from '@/lib/api';
import { countryDisplayName } from '@/lib/country-name';
import { env } from '@/lib/env';
import { buildJobPostingJsonLd } from '@/lib/job-offer-jsonld';
import { formatMoney, requireMoney } from '@/lib/money';
import { serializeJsonLd } from '@/lib/profile-jsonld';
import { buildRobotsMetadata } from '@/lib/robots';
import { getSession } from '@/lib/session';
import { absoluteUrl, localeAlternates } from '@/lib/site-url';
import { truncateAtWordBoundary } from '@/lib/truncate';

import { ApplyForm } from './apply-form';

const REVALIDATE_SECONDS = 300;
const DESCRIPTION_MAX_LENGTH = 160;
const LOGO_SIZE = 48;

function jobOfferPath(slug: string): string {
  return `/job-offers/${slug}`;
}

// No page-level `export const revalidate`: this page reads headers() for the
// CSP nonce, and Next rejects a segment that both declares a static
// revalidate window and calls a Dynamic API - the `api.GET` call below sets
// its own `next.revalidate` instead (mirrors photographers/[slug]/page.tsx).
export function generateStaticParams() {
  return [];
}

// A 404 here already covers expired, closed, taken-down and never-existed
// slugs indistinguishably - the public endpoint filters all four server-side
// and returns the same 404 either way, so this page renders one not-found
// state without trying to explain which of them happened
// (docs/steps/1B.9-professional-area.md).
export const loadJobOffer = cache(async (slug: string) => {
  const result = await api.GET('/v1/job-offers/{slug}', {
    params: { path: { slug } },
    next: { revalidate: REVALIDATE_SECONDS },
  });
  if (result.response.status === 404) {
    return null;
  }
  if (!result.data) {
    throw new Error(`Failed to load job offer "${slug}": HTTP ${String(result.response.status)}`);
  }
  return result.data;
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> {
  const { locale: requestedLocale, slug } = await params;
  if (!isLocale(requestedLocale)) {
    return {};
  }
  const locale: Locale = requestedLocale;

  const offer = await loadJobOffer(slug);
  if (!offer) {
    return {};
  }

  const t = await getTranslations({ locale, namespace: 'web.jobBoard.detail' });
  const description = truncateAtWordBoundary(offer.description, DESCRIPTION_MAX_LENGTH);
  const path = jobOfferPath(slug);

  return {
    title: t('metaTitle', { title: offer.title, companyName: offer.company.companyName }),
    description,
    robots: buildRobotsMetadata(env.NEXT_PUBLIC_ALLOW_INDEXING),
    alternates: {
      canonical: absoluteUrl(locale, path),
      languages: localeAlternates(path),
    },
    openGraph: {
      type: 'website',
      title: offer.title,
      description,
      url: absoluteUrl(locale, path),
      locale,
    },
  };
}

export default async function JobOfferDetailPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale: requestedLocale, slug } = await params;
  if (!isLocale(requestedLocale)) {
    notFound();
  }
  const locale: Locale = requestedLocale;

  const [offer, headersList, user] = await Promise.all([
    loadJobOffer(slug),
    headers(),
    getSession(),
  ]);
  if (!offer) {
    notFound();
  }

  const [t, tBoard, tApply, tCategories] = await Promise.all([
    getTranslations({ locale, namespace: 'web.jobBoard.detail' }),
    getTranslations({ locale, namespace: 'web.jobBoard' }),
    getTranslations({ locale, namespace: 'web.jobBoard.apply' }),
    getTranslations({ locale, namespace: 'common.categories' }),
  ]);

  const nonce = headersList.get('x-nonce');
  const jsonLd = buildJobPostingJsonLd({ offer });

  const applicationsHref = `/${locale}/account/job-applications`;
  const signInHref = `/${locale}/sign-in?next=${encodeURIComponent(`/${locale}${jobOfferPath(slug)}`)}`;

  const country = countryDisplayName(offer.countryCode, locale);
  const locationLine = offer.remote
    ? `${tBoard('remoteLabel')} (${offer.city}, ${country})`
    : `${offer.city}, ${country}`;

  return (
    <article className="mx-auto flex max-w-3xl flex-col gap-10 px-4 py-12">
      <script
        type="application/ld+json"
        nonce={nonce ?? undefined}
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
      />

      <Link
        href={`/${locale}/job-offers`}
        className="self-start text-sm font-medium text-primary underline-offset-4 hover:underline"
      >
        {t('backToBoard')}
      </Link>

      <header className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          {offer.company.logoUrl ? (
            <Image
              src={offer.company.logoUrl}
              alt={offer.company.companyName}
              width={LOGO_SIZE}
              height={LOGO_SIZE}
              className="size-12 shrink-0 rounded-full object-cover"
            />
          ) : (
            <div className="size-12 shrink-0 rounded-full bg-muted" aria-hidden="true" />
          )}
          <div className="flex flex-col gap-1">
            <span className="font-medium text-foreground">{offer.company.companyName}</span>
            <div className="flex flex-wrap items-center gap-2">
              {offer.company.verified ? <StatusBadge label={t('verifiedBadge')} /> : null}
              {offer.company.website ? (
                <a
                  href={offer.company.website}
                  target="_blank"
                  rel="nofollow ugc noopener noreferrer"
                  className="text-sm text-primary underline-offset-4 hover:underline"
                >
                  {t('companyWebsiteLabel')}
                </a>
              ) : null}
            </div>
          </div>
        </div>

        <h1 className="text-3xl font-semibold text-foreground">{offer.title}</h1>

        <p className="text-muted-foreground">
          {tCategories(offer.category)}
          {' · '}
          {locationLine}
        </p>

        {offer.compensation ? (
          <p className="font-medium text-foreground">
            {t('compensationHeading')}:{' '}
            {tBoard('compensationRange', {
              min: formatMoney(
                requireMoney(offer.compensation.min, `job offer "${offer.id}" compensation min`),
                locale,
              ),
              max: formatMoney(
                requireMoney(offer.compensation.max, `job offer "${offer.id}" compensation max`),
                locale,
              ),
            })}
          </p>
        ) : null}
      </header>

      <section className="flex flex-col gap-2">
        <h2 className="text-xl font-semibold text-foreground">{t('descriptionHeading')}</h2>
        <p className="whitespace-pre-line text-foreground">{offer.description}</p>
      </section>

      {offer.startDate || offer.endDate ? (
        <dl className="flex flex-wrap gap-6 text-sm text-muted-foreground">
          {offer.startDate ? (
            <div>
              <dt className="font-medium text-foreground">{t('startDateLabel')}</dt>
              <dd>
                <FormattedDateTime value={offer.startDate} locale={locale} />
              </dd>
            </div>
          ) : null}
          {offer.endDate ? (
            <div>
              <dt className="font-medium text-foreground">{t('endDateLabel')}</dt>
              <dd>
                <FormattedDateTime value={offer.endDate} locale={locale} />
              </dd>
            </div>
          ) : null}
        </dl>
      ) : null}

      <p className="text-sm text-muted-foreground">
        {t('expiresLabel')}: <FormattedDateTime value={offer.expiresAt} locale={locale} />
      </p>

      <section className="flex flex-col gap-4 rounded-lg border border-border p-6">
        <h2 className="text-xl font-semibold text-foreground">{tApply('heading')}</h2>
        <p className="text-sm text-muted-foreground">{t('contactNotice')}</p>
        {user ? (
          user.emailVerifiedAt ? (
            <ApplyForm jobOfferId={offer.id} applicationsHref={applicationsHref} />
          ) : (
            <EmailVerificationRequired email={user.email} />
          )
        ) : (
          <ApplyForm
            jobOfferId={offer.id}
            applicationsHref={applicationsHref}
            signInHref={signInHref}
          />
        )}
      </section>
    </article>
  );
}
