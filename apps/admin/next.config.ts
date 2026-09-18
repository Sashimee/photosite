import { fileURLToPath } from 'node:url';

import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

import { env } from './src/lib/env';
import { buildSecurityHeaders } from './src/lib/security-headers';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: fileURLToPath(new URL('../..', import.meta.url)),
  ...(env.ADMIN_BASE_PATH ? { basePath: env.ADMIN_BASE_PATH } : {}),
  headers() {
    return [
      {
        source: '/(.*)',
        headers: buildSecurityHeaders(process.env.NODE_ENV === 'production'),
      },
    ];
  },
};

export default withNextIntl(nextConfig);
