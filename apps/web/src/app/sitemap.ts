import type { MetadataRoute } from 'next';

import { env } from '@/lib/env';
import { buildSitemap } from '@/lib/sitemap';

// Matches the fastest-changing source the sitemap reads from
// (`/v1/photographers`, `/v1/job-offers`, both revalidated every 300s
// elsewhere in the app); the discovery landing sources revalidate on their
// own, longer 3600s window regardless of this route's own regeneration.
export const revalidate = 300;

// A sitemap that lists URLs while robots.txt disallows everything is a
// contradiction search engines report as an error, so this stays empty
// whenever the site isn't indexable - never a stale or partial list
// (docs/steps/1B.11-seo.md).
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  if (!env.NEXT_PUBLIC_ALLOW_INDEXING) {
    return [];
  }
  return buildSitemap();
}
