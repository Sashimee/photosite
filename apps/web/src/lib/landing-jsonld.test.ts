import { describe, expect, it } from 'vitest';

import type { components } from '@photoo/api-client';

import { buildItemListJsonLd } from './landing-jsonld';
import { serializeJsonLd } from './profile-jsonld';

type PhotographerSummary = components['schemas']['PhotographerSummary'];

function summary(overrides: Partial<PhotographerSummary>): PhotographerSummary {
  return {
    id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
    slug: 'sofia-martins',
    displayName: 'Sofia Martins',
    headline: null,
    avatarUrl: null,
    categories: ['wedding'],
    languages: ['en'],
    city: 'Luxembourg City',
    countryCode: 'LU',
    ratingAvg: 0,
    ratingCount: 0,
    startingPrice: null,
    ...overrides,
  };
}

describe('buildItemListJsonLd', () => {
  it('builds one-based ListItem entries in result order', () => {
    const jsonLd = buildItemListJsonLd({
      items: [summary({ slug: 'a', displayName: 'A' }), summary({ slug: 'b', displayName: 'B' })],
      urlFor: (slug) => `https://photoo.lu/en/photographers/${slug}`,
    });

    expect(jsonLd).toMatchObject({
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      itemListElement: [
        {
          '@type': 'ListItem',
          position: 1,
          url: 'https://photoo.lu/en/photographers/a',
          name: 'A',
        },
        {
          '@type': 'ListItem',
          position: 2,
          url: 'https://photoo.lu/en/photographers/b',
          name: 'B',
        },
      ],
    });
  });

  it('serializes with escaped display names that could break out of the script tag', () => {
    const jsonLd = buildItemListJsonLd({
      items: [summary({ slug: 'a', displayName: '</script><script>alert(1)</script>' })],
      urlFor: (slug) => `https://photoo.lu/en/photographers/${slug}`,
    });

    const serialized = serializeJsonLd(jsonLd);

    expect(serialized).not.toContain('</script>');
    expect(JSON.parse(serialized)).toMatchObject({
      itemListElement: [{ name: '</script><script>alert(1)</script>' }],
    });
  });
});
