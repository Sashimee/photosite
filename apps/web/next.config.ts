import { fileURLToPath } from 'node:url';

import { withSentryConfig } from '@sentry/nextjs/config';
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

import { env } from './src/lib/env';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const isProduction = process.env.NODE_ENV === 'production';
const isDevelopment = process.env.NODE_ENV === 'development';

const mediaBaseUrl = env.NEXT_PUBLIC_MEDIA_BASE_URL
  ? new URL(env.NEXT_PUBLIC_MEDIA_BASE_URL)
  : null;

const nextConfig: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: fileURLToPath(new URL('../..', import.meta.url)),
  images: {
    remotePatterns: mediaBaseUrl
      ? [
          {
            protocol: mediaBaseUrl.protocol.replace(':', '') as 'http' | 'https',
            hostname: mediaBaseUrl.hostname,
            port: mediaBaseUrl.port,
            pathname: `${mediaBaseUrl.pathname.replace(/\/$/, '')}/**`,
          },
        ]
      : [],
    // The local stack's media origin (http://localhost:9000) is a local IP,
    // which Next's image optimizer otherwise refuses to fetch from.
    ...(isDevelopment ? { dangerouslyAllowLocalIP: true } : {}),
  },
  headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          {
            key: 'Permissions-Policy',
            // geolocation=(self): the "near me" search filter reads it on
            // click only, never automatically (docs/steps/1B.4-discovery.md).
            value: 'camera=(), microphone=(), geolocation=(self), interest-cohort=()',
          },
          ...(isProduction
            ? [
                {
                  key: 'Strict-Transport-Security',
                  value: 'max-age=63072000; includeSubDomains; preload',
                },
              ]
            : []),
          ...(env.NEXT_PUBLIC_ALLOW_INDEXING
            ? []
            : [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }]),
        ],
      },
    ];
  },
};

const sentryEnvOptions = {
  ...(process.env.SENTRY_ORG ? { org: process.env.SENTRY_ORG } : {}),
  ...(process.env.SENTRY_PROJECT ? { project: process.env.SENTRY_PROJECT } : {}),
  ...(process.env.SENTRY_AUTH_TOKEN ? { authToken: process.env.SENTRY_AUTH_TOKEN } : {}),
};

export default withSentryConfig(withNextIntl(nextConfig), {
  ...sentryEnvOptions,
  silent: true,
  telemetry: false,
  webpack: {
    treeshake: { removeDebugLogging: true },
  },
});
