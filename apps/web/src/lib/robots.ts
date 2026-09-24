import type { Metadata, MetadataRoute } from 'next';

// A sitemap that lists URLs while robots.txt disallows everything is a
// contradiction search engines report as an error, so the sitemap directive
// only ever appears alongside `allow: '/'` - never alongside `disallow: '/'`,
// where `app/sitemap.ts` itself also returns an empty list.
export function buildRobotsRules(allowIndexing: boolean, siteUrl: string): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      ...(allowIndexing ? { allow: '/' } : { disallow: '/' }),
    },
    ...(allowIndexing ? { sitemap: `${siteUrl}/sitemap.xml` } : {}),
  };
}

export function buildRobotsMetadata(allowIndexing: boolean): Metadata['robots'] {
  return allowIndexing ? undefined : { index: false, follow: false };
}
