import { describe, expect, it } from 'vitest';

import { buildCspHeader, originOf, websocketOrigin } from './csp';

describe('buildCspHeader', () => {
  it('includes the nonce in script-src and style-src for production', () => {
    const header = buildCspHeader('abc123', false);
    expect(header).toContain(`script-src 'self' 'nonce-abc123' 'strict-dynamic'`);
    expect(header).toContain(`style-src 'self' 'nonce-abc123'`);
    // `style-src-attr` is the one deliberate exception (#176); nothing else
    // may relax inline content, so the blanket assertion is narrowed rather
    // than dropped.
    expect(header).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(header).not.toMatch(/style-src [^;]*unsafe-inline/);
    expect(header).not.toContain('unsafe-eval');
    expect(header.match(/unsafe-inline/g)).toHaveLength(1);
  });

  it('relaxes script-src and style-src in development', () => {
    const header = buildCspHeader('abc123', true);
    expect(header).toContain(`script-src 'self' 'nonce-abc123' 'strict-dynamic' 'unsafe-eval'`);
    expect(header).toContain(`style-src 'self' 'unsafe-inline'`);
  });

  // #176: a nonce cannot cover a style *attribute*, and Next's runtime emits
  // them on every page, so those are allowed explicitly - while inline
  // <style> elements still require the nonce and scripts stay strict.
  it('relaxes style attributes without relaxing style elements or scripts', () => {
    const header = buildCspHeader('abc123', false);
    expect(header).toContain(`style-src-attr 'unsafe-inline'`);
    expect(header).toContain(`style-src 'self' 'nonce-abc123'`);
    expect(header).not.toMatch(/script-src[^;]*unsafe-inline/);
  });

  it('always denies framing and blocks plugins', () => {
    const header = buildCspHeader('abc123', false);
    expect(header).toContain(`frame-ancestors 'none'`);
    expect(header).toContain(`object-src 'none'`);
  });

  it('allows connections to the API and Sentry origins only in addition to self', () => {
    const header = buildCspHeader('abc123', false, [
      'https://api.photoo.lu',
      'https://o1.ingest.sentry.io',
    ]);
    expect(header).toContain(
      "connect-src 'self' https://api.photoo.lu https://o1.ingest.sentry.io;",
    );
  });

  it('only allows self, blob and data image sources when no media origin is set', () => {
    const header = buildCspHeader('abc123', false);
    expect(header).toContain("img-src 'self' blob: data:;");
  });

  it('allows the media origin in img-src when set', () => {
    const header = buildCspHeader('abc123', false, [], ['https://footoo.bas.lu']);
    expect(header).toContain("img-src 'self' blob: data: https://footoo.bas.lu;");
  });
});

describe('originOf', () => {
  it('reduces a URL to its origin', () => {
    expect(originOf('http://127.0.0.1:4010/v1')).toBe('http://127.0.0.1:4010');
    expect(originOf('https://key@o1.ingest.sentry.io/123')).toBe('https://o1.ingest.sentry.io');
  });

  it('returns null for an unset URL', () => {
    expect(originOf(undefined)).toBeNull();
  });
});

describe('websocketOrigin', () => {
  it('maps http to ws and https to wss', () => {
    expect(websocketOrigin('http://127.0.0.1:4010')).toBe('ws://127.0.0.1:4010');
    expect(websocketOrigin('https://api.photoo.lu')).toBe('wss://api.photoo.lu');
  });

  it('returns null for a null origin', () => {
    expect(websocketOrigin(null)).toBeNull();
  });
});
