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
  stripeEnabled = false,
): string {
  const cspDirectives = [
    `default-src 'self'`,
    // Stripe.js is only ever loaded via loadStripe from its own CDN, which
    // requires script-src to allow it directly (Stripe forbids self-hosting
    // js.stripe.com, so there's no nonce path for it). Only added when a
    // publishable key is configured, per docs/steps/1B.7-checkout.md.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? ` 'unsafe-eval'` : ''}${stripeEnabled ? ' https://js.stripe.com' : ''}`,
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
    [
      'connect-src',
      "'self'",
      ...connectOrigins,
      ...(stripeEnabled ? ['https://api.stripe.com'] : []),
    ].join(' '),
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
    `upgrade-insecure-requests`,
  ];

  // The Payment Element renders Stripe's own hosted iframes for card entry
  // and 3DS challenges (hooks.stripe.com); frame-src otherwise defaults shut
  // by the absence of a frame-ancestors-only policy.
  if (stripeEnabled) {
    cspDirectives.push(`frame-src https://js.stripe.com https://hooks.stripe.com`);
  }

  return cspDirectives.join('; ');
}
