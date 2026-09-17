import { getTranslations } from 'next-intl/server';
import Image from 'next/image';

import type { components } from '@photoo/api-client';
import { PHOTOGRAPHER_CATEGORIES, type Locale } from '@photoo/shared';

type PublicPhotographerProfile = components['schemas']['PublicPhotographerProfile'];

// The API doesn't return avatar/cover dimensions (only portfolio images
// carry width/height), so these are fixed display sizes rather than the
// image's real intrinsic size - next/image still needs width/height (or
// `fill`) to reserve layout space and avoid shifting content in.
const AVATAR_SIZE = 96;
const COVER_WIDTH = 1200;
const COVER_HEIGHT = 400;

async function languageLabel(code: string, locale: Locale): Promise<string> {
  const tLocale = await getTranslations({ locale, namespace: 'locale' });
  if (tLocale.has(code)) {
    return tLocale(code);
  }
  try {
    return new Intl.DisplayNames([locale], { type: 'language' }).of(code) ?? code;
  } catch (error) {
    if (error instanceof RangeError) {
      return code;
    }
    throw error;
  }
}

export async function ProfileHeader({
  profile,
  locale,
}: {
  profile: PublicPhotographerProfile;
  locale: Locale;
}) {
  const [t, tCategories] = await Promise.all([
    getTranslations({ locale, namespace: 'web.profile' }),
    getTranslations({ locale, namespace: 'common.categories' }),
  ]);
  const languageLabels = await Promise.all(
    profile.languages.map((code) => languageLabel(code, locale)),
  );

  return (
    <header className="flex flex-col gap-4">
      {profile.coverUrl ? (
        <div className="overflow-hidden rounded-lg">
          <Image
            src={profile.coverUrl}
            alt=""
            width={COVER_WIDTH}
            height={COVER_HEIGHT}
            sizes="100vw"
            className="h-48 w-full object-cover sm:h-64"
            priority
          />
        </div>
      ) : null}
      <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
        {profile.avatarUrl ? (
          <Image
            src={profile.avatarUrl}
            alt={profile.displayName}
            width={AVATAR_SIZE}
            height={AVATAR_SIZE}
            className="size-24 shrink-0 rounded-full object-cover"
          />
        ) : null}
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold text-foreground sm:text-3xl">
            {profile.displayName}
          </h1>
          {profile.headline ? <p className="text-muted-foreground">{profile.headline}</p> : null}
          <p className="text-sm text-muted-foreground">{profile.city}</p>
          {profile.ratingCount > 0 ? (
            <p className="text-sm text-foreground">
              {t('rating', { ratingAvg: profile.ratingAvg, ratingCount: profile.ratingCount })}
            </p>
          ) : null}
        </div>
      </div>
      {profile.categories.length > 0 ? (
        <ul className="flex flex-wrap gap-2" aria-label={t('categoriesHeading')}>
          {PHOTOGRAPHER_CATEGORIES.filter((category) => profile.categories.includes(category)).map(
            (category) => (
              <li
                key={category}
                className="rounded-full bg-secondary px-3 py-1 text-xs font-medium text-secondary-foreground"
              >
                {tCategories(category)}
              </li>
            ),
          )}
        </ul>
      ) : null}
      {languageLabels.length > 0 ? (
        <p className="text-sm text-muted-foreground">
          {t('languages', { languages: languageLabels.join(', ') })}
        </p>
      ) : null}
    </header>
  );
}
