import { getTranslations } from 'next-intl/server';
import Image from 'next/image';
import Link from 'next/link';

import type { components } from '@photoo/api-client';
import type { Locale } from '@photoo/shared';

import { StatusBadge } from '@/components/requests/status-badge';
import { countryDisplayName } from '@/lib/country-name';
import { formatMoney, requireMoney } from '@/lib/money';
import { formatRelativeTime } from '@/lib/relative-time';

// Same `JobOfferInput` fix as account/job-offers/job-offer-form-helpers.ts:
// `location`'s generated type intersects `LatLng` with `Record<string,
// never> | null`, which a plain `{ lat, lng }` object never structurally
// satisfies.
export type PublicJobOfferSummary = Omit<
  components['schemas']['PublicJobOfferSummary'],
  'location'
> & {
  location: { lat: number; lng: number } | null;
};

const LOGO_SIZE = 48;

export async function JobOfferCard({
  offer,
  locale,
}: {
  offer: PublicJobOfferSummary;
  locale: Locale;
}) {
  const [t, tCategories] = await Promise.all([
    getTranslations({ locale, namespace: 'web.jobBoard' }),
    getTranslations({ locale, namespace: 'common.categories' }),
  ]);

  const country = countryDisplayName(offer.countryCode, locale);
  const locationLine = offer.remote
    ? `${t('remoteLabel')} (${offer.city}, ${country})`
    : `${offer.city}, ${country}`;

  return (
    <li className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <Link href={`/${locale}/job-offers/${offer.slug}`} className="flex items-start gap-3">
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
        <div className="flex flex-col gap-0.5">
          <span className="font-medium text-foreground">{offer.title}</span>
          <div className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
            <span>{offer.company.companyName}</span>
            {offer.company.verified ? <StatusBadge label={t('detail.verifiedBadge')} /> : null}
          </div>
          <span className="text-sm text-muted-foreground">{locationLine}</span>
        </div>
      </Link>
      <p className="text-sm text-muted-foreground">{tCategories(offer.category)}</p>
      {offer.compensation ? (
        <p className="text-sm font-medium text-foreground">
          {t('compensationRange', {
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
      <p className="text-xs text-muted-foreground">
        {t('postedAgo', { relative: formatRelativeTime(offer.publishedAt, locale) })}
      </p>
    </li>
  );
}
