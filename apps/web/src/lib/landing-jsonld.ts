import type { components } from '@photoo/api-client';

type PhotographerSummary = components['schemas']['PhotographerSummary'];

export interface ItemListJsonLdInput {
  items: readonly PhotographerSummary[];
  urlFor: (slug: string) => string;
}

export function buildItemListJsonLd({
  items,
  urlFor,
}: ItemListJsonLdInput): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      url: urlFor(item.slug),
      name: item.displayName,
    })),
  };
}
