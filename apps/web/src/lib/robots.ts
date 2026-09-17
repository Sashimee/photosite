import type { Metadata, MetadataRoute } from 'next';

export function buildRobotsRules(allowIndexing: boolean): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      ...(allowIndexing ? { allow: '/' } : { disallow: '/' }),
    },
  };
}

export function buildRobotsMetadata(allowIndexing: boolean): Metadata['robots'] {
  return allowIndexing ? undefined : { index: false, follow: false };
}
