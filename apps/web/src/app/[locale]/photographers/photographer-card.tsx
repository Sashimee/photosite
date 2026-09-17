import { getTranslations } from 'next-intl/server';
import Image from 'next/image';
import Link from 'next/link';

import type { components } from '@photoo/api-client';
import { PHOTOGRAPHER_CATEGORIES, type Locale } from '@photoo/shared';

import { formatMoney } from '@/lib/money';

type PhotographerSummary = components['schemas']['PhotographerSummary'];

const AVATAR_SIZE = 64;

export async function PhotographerCard({
  photographer,
  locale,
}: {
  photographer: PhotographerSummary;
  locale: Locale;
}) {
  const [t, tCategories] = await Promise.all([
    getTranslations({ locale, namespace: 'web.profile' }),
    getTranslations({ locale, namespace: 'common.categories' }),
  ]);
  const fromPrice = formatMoney(photographer.startingPrice, locale);

  return (
    <li className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <Link
        href={`/${locale}/photographers/${photographer.slug}`}
        className="flex items-center gap-3"
      >
        {photographer.avatarUrl ? (
          <Image
            src={photographer.avatarUrl}
            alt={photographer.displayName}
            width={AVATAR_SIZE}
            height={AVATAR_SIZE}
            className="size-16 shrink-0 rounded-full object-cover"
          />
        ) : (
          <div className="size-16 shrink-0 rounded-full bg-muted" aria-hidden="true" />
        )}
        <div className="flex flex-col gap-0.5">
          <span className="font-medium text-foreground">{photographer.displayName}</span>
          {photographer.headline ? (
            <span className="text-sm text-muted-foreground">{photographer.headline}</span>
          ) : null}
          <span className="text-sm text-muted-foreground">{photographer.city}</span>
        </div>
      </Link>
      {photographer.categories.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {PHOTOGRAPHER_CATEGORIES.filter((category) =>
            photographer.categories.includes(category),
          ).map((category) => (
            <li
              key={category}
              className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground"
            >
              {tCategories(category)}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex items-center justify-between gap-2 text-sm">
        {photographer.ratingCount > 0 ? (
          <span className="text-foreground">
            {t('rating', {
              ratingAvg: photographer.ratingAvg,
              ratingCount: photographer.ratingCount,
            })}
          </span>
        ) : (
          <span />
        )}
        {fromPrice ? (
          <span className="font-medium text-foreground">
            {t('fromPrice', { price: fromPrice })}
          </span>
        ) : null}
      </div>
    </li>
  );
}
