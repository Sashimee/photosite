export function buildSecurityHeaders(isProduction: boolean): { key: string; value: string }[] {
  return [
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
    // Unconditional: unlike apps/web there is no environment where the
    // admin app should be indexed (docs/steps/1D.1-admin-shell.md).
    { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
    ...(isProduction
      ? [
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
        ]
      : []),
  ];
}
