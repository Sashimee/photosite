export function originOf(url: string | undefined): string | null {
  return url ? new URL(url).origin : null;
}

// Modern browsers already map `wss:`/`ws:` sources onto `https:`/`http:`
// connect-src entries, but Safari didn't reliably do so until recently, so
// the API origin is listed under both schemes for the chat socket.
export function websocketOrigin(origin: string | null): string | null {
  return origin ? origin.replace(/^http/, 'ws') : null;
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
    // A nonce cannot cover a `style="..."` *attribute* - the spec excludes
    // attributes from nonce matching - and Next's own runtime ships them on
    // every page (the route announcer, `next/image` sizing). Without this the
    // browser dropped those styles and logged a CSP violation per page, which
    // buried real console errors during the 2026-09-18 outage (#176).
    // Scoped deliberately: this relaxes style *attributes* only. Inline
    // `<style>` elements still need the nonce, and `script-src` is untouched.
    `style-src-attr 'unsafe-inline'`,
    ['img-src', "'self'", 'blob:', 'data:', ...imgOrigins].join(' '),
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
