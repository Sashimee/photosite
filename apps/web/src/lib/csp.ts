export function originOf(url: string | undefined): string | null {
  return url ? new URL(url).origin : null;
}

export function buildCspHeader(
  nonce: string,
  isDev: boolean,
  connectOrigins: readonly string[] = [],
): string {
  const cspDirectives = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? ` 'unsafe-eval'` : ''}`,
    `style-src 'self' ${isDev ? `'unsafe-inline'` : `'nonce-${nonce}'`}`,
    `img-src 'self' blob: data:`,
    `font-src 'self'`,
    ['connect-src', "'self'", ...connectOrigins].join(' '),
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
    `upgrade-insecure-requests`,
  ];

  return cspDirectives.join('; ');
}
