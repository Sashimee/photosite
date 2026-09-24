import type { MetadataRoute } from 'next';

import { env } from '@/lib/env';
import { buildRobotsRules } from '@/lib/robots';

export default function robots(): MetadataRoute.Robots {
  return buildRobotsRules(env.NEXT_PUBLIC_ALLOW_INDEXING, env.NEXT_PUBLIC_SITE_URL);
}
