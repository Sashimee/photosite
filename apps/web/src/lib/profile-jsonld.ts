import type { components } from '@photoo/api-client';
import type { Locale } from '@photoo/shared';

import { resolveLocalizedText } from './localized-text';
import { requireMoney } from './money';

type PublicPhotographerProfile = components['schemas']['PublicPhotographerProfile'];
type Product = components['schemas']['Product'];
type ProductTier = Product['tiers'][number];

export interface ProfileJsonLdInput {
  profile: PublicPhotographerProfile;
  products: readonly Product[];
  locale: Locale;
  url: string;
}

// English, not `common.licenceUsages`: JSON-LD is machine-readable
// structured data for search engines rather than page UI, so it stays in
// one canonical language regardless of the route locale.
const LICENCE_USAGE_LABELS: Record<ProductTier['usage'], string> = {
  personal: 'Personal use',
  commercial: 'Commercial use',
  editorial: 'Editorial use',
  extended: 'Extended use',
};

function buildOffers(products: readonly Product[], locale: Locale): Record<string, unknown>[] {
  const offers: Record<string, unknown>[] = [];
  for (const product of products) {
    if (!product.isActive) {
      continue;
    }
    const title = resolveLocalizedText(product.title, locale)?.text ?? '';
    for (const tier of product.tiers) {
      const price = requireMoney(tier.price, `product "${product.id}" tier "${tier.id}"`);
      offers.push({
        '@type': 'Offer',
        itemOffered: {
          '@type': 'Service',
          name: `${title} (${LICENCE_USAGE_LABELS[tier.usage]})`,
        },
        priceSpecification: {
          '@type': 'PriceSpecification',
          price: (price.amountCents / 100).toFixed(2),
          priceCurrency: price.currency,
        },
      });
    }
  }
  return offers;
}

export function buildProfileJsonLd({
  profile,
  products,
  locale,
  url,
}: ProfileJsonLdInput): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'ProfessionalService',
    name: profile.displayName,
    url,
    ...(profile.avatarUrl ? { image: profile.avatarUrl } : {}),
    address: {
      '@type': 'PostalAddress',
      addressLocality: profile.city,
      addressCountry: profile.countryCode,
    },
    areaServed: profile.city,
    knowsLanguage: profile.languages,
    founder: {
      '@type': 'Person',
      name: profile.displayName,
    },
    makesOffer: buildOffers(products, locale),
    ...(profile.ratingCount > 0
      ? {
          aggregateRating: {
            '@type': 'AggregateRating',
            ratingValue: profile.ratingAvg,
            ratingCount: profile.ratingCount,
          },
        }
      : {}),
  };
}

// `<`/`>`/`&` are escaped as unicode so user-controlled text (display name,
// bio, product titles) can never close the surrounding <script> tag.
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}
