import { getTranslations } from 'next-intl/server';
import Image from 'next/image';

import type { components } from '@photoo/api-client';
import type { Locale } from '@photoo/shared';

type PublicPortfolioImage = components['schemas']['PublicPortfolioImage'];

export async function PortfolioGrid({
  images,
  displayName,
  locale,
}: {
  images: readonly PublicPortfolioImage[];
  displayName: string;
  locale: Locale;
}) {
  if (images.length === 0) {
    return null;
  }

  const t = await getTranslations({ locale, namespace: 'web.profile' });
  const sorted = [...images].sort((a, b) => a.order - b.order);

  return (
    <section aria-label={t('portfolioHeading')}>
      <div className="columns-2 gap-3 sm:columns-3">
        {sorted.map((image, index) => (
          <Image
            key={image.id}
            src={image.url}
            alt={t('portfolioImageAlt', { displayName, index: index + 1 })}
            width={image.width}
            height={image.height}
            sizes="(min-width: 640px) 33vw, 50vw"
            className="mb-3 w-full break-inside-avoid rounded-lg object-cover"
          />
        ))}
      </div>
    </section>
  );
}
