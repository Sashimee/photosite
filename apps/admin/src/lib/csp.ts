export function originOf(url: string | undefined): string | null {
  return url ? new URL(url).origin : null;
}

export function buildCspHeader(
  nonce: string,
  isDev: boolean,
  connectOrigins: readonly string[] = [],
  imgOrigins: readonly string[] = [],
): string {
  const cspDirectives = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? ` 'unsafe-eval'` : ''}`,
    `style-src 'self' ${isDev ? `'unsafe-inline'` : `'nonce-${nonce}'`}`,
    // Same reason as apps/web (#176): a nonce cannot cover a `style="..."`
    // attribute, and Next's own runtime emits them. Style attributes only -
    // inline <style> elements still need the nonce and script-src is strict.
    `style-src-attr 'unsafe-inline'`,
    ['img-src', "'self'", 'blob:', 'data:', ...imgOrigins].join(' '),
    `font-src 'self'`,
    ['connect-src', "'self'", ...connectOrigins].join(' '),
    // The verification document viewer renders a PDF in a sandboxed iframe
    // pointed at a blob: object URL (docs/steps/1D.3-verification-queue.md);
    // frame-src has no other reason to diverge from denying everything else.
    `frame-src 'self' blob:`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
    `upgrade-insecure-requests`,
  ];

  return cspDirectives.join('; ');
}
