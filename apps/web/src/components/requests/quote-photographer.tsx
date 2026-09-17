import Image from 'next/image';
import Link from 'next/link';

import type { components } from '@photoo/api-client';
import type { Locale } from '@photoo/shared';

type QuotePhotographerDto = components['schemas']['QuotePhotographer'];

const AVATAR_SIZE = 40;

// Sync and translation-free, like StatusBadge: the caller (already async,
// resolving other translations) formats `ratingLabel` and passes it down,
// so this can sit inside a plain client-rendered React tree in tests.
export function QuotePhotographer({
  photographer,
  locale,
  ratingLabel,
}: {
  photographer: QuotePhotographerDto;
  locale: Locale;
  ratingLabel: string | null;
}) {
  return (
    <Link
      href={`/${locale}/photographers/${photographer.slug}`}
      className="flex items-center gap-2"
    >
      {photographer.avatarUrl ? (
        <Image
          src={photographer.avatarUrl}
          alt={photographer.displayName}
          width={AVATAR_SIZE}
          height={AVATAR_SIZE}
          className="size-10 shrink-0 rounded-full object-cover"
        />
      ) : (
        <div className="size-10 shrink-0 rounded-full bg-muted" aria-hidden="true" />
      )}
      <span className="flex flex-col">
        <span className="text-sm font-medium text-foreground">{photographer.displayName}</span>
        <span className="text-xs text-muted-foreground">
          {photographer.city}
          {ratingLabel ? ` · ${ratingLabel}` : ''}
        </span>
      </span>
    </Link>
  );
}
