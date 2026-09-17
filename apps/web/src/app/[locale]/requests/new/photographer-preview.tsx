import { getTranslations } from 'next-intl/server';
import Image from 'next/image';
import Link from 'next/link';

import type { components } from '@photoo/api-client';
import type { Locale } from '@photoo/shared';

import { resolveLocalizedText } from '@/lib/localized-text';
import { formatMoney, requireMoney } from '@/lib/money';

import { DirectQuoteButton } from './direct-quote-button';

type PublicPhotographerProfile = components['schemas']['PublicPhotographerProfile'];
type Product = components['schemas']['Product'];

const AVATAR_SIZE = 64;

export async function PhotographerPreview({
  profile,
  products,
  slug,
  locale,
}: {
  profile: PublicPhotographerProfile;
  products: readonly Product[];
  slug: string;
  locale: Locale;
}) {
  const [tNew, tLicenceUsages] = await Promise.all([
    getTranslations({ locale, namespace: 'web.requests.new' }),
    getTranslations({ locale, namespace: 'common.licenceUsages' }),
  ]);
  const activeProducts = products.filter((product) => product.isActive);

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-border p-4">
      <Link href={`/${locale}/photographers/${slug}`} className="flex items-center gap-3">
        {profile.avatarUrl ? (
          <Image
            src={profile.avatarUrl}
            alt={profile.displayName}
            width={AVATAR_SIZE}
            height={AVATAR_SIZE}
            className="size-16 shrink-0 rounded-full object-cover"
          />
        ) : (
          <div className="size-16 shrink-0 rounded-full bg-muted" aria-hidden="true" />
        )}
        <div className="flex flex-col gap-0.5">
          <span className="font-medium text-foreground">{profile.displayName}</span>
          {profile.headline ? (
            <span className="text-sm text-muted-foreground">{profile.headline}</span>
          ) : null}
          <span className="text-sm text-muted-foreground">{profile.city}</span>
        </div>
      </Link>

      <p className="text-sm text-muted-foreground">
        {tNew('photographerIntro', { displayName: profile.displayName })}
      </p>

      {activeProducts.length > 0 ? (
        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-foreground">
            {tNew('directQuote.productsHeading')}
          </h2>
          <ul className="flex flex-col gap-3">
            {activeProducts.map((product) => {
              const title = resolveLocalizedText(product.title, locale);
              return (
                <li
                  key={product.id}
                  className="flex flex-col gap-2 rounded-md border border-border p-3"
                >
                  <span
                    className="font-medium text-foreground"
                    {...(title && title.locale !== locale ? { lang: title.locale } : {})}
                  >
                    {title?.text ?? ''}
                  </span>
                  <ul className="flex flex-col gap-2">
                    {product.tiers.map((tier) => (
                      <li
                        key={tier.id}
                        className="flex items-center justify-between gap-3 text-sm text-muted-foreground"
                      >
                        <span>
                          {tLicenceUsages(tier.usage)}
                          {' — '}
                          {formatMoney(
                            requireMoney(tier.price, `product "${product.id}" tier "${tier.id}"`),
                            locale,
                          )}
                        </span>
                        <DirectQuoteButton
                          locale={locale}
                          slug={slug}
                          productId={product.id}
                          tierId={tier.id}
                          label={tNew('directQuote.cta')}
                        />
                      </li>
                    ))}
                  </ul>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
