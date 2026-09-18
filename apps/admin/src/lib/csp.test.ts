import { describe, expect, it } from 'vitest';

import { buildCspHeader, originOf } from './csp';

describe('buildCspHeader', () => {
  it('includes the nonce in script-src and style-src for production', () => {
    const header = buildCspHeader('abc123', false);
    expect(header).toContain(`script-src 'self' 'nonce-abc123' 'strict-dynamic'`);
    expect(header).toContain(`style-src 'self' 'nonce-abc123'`);
    expect(header).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(header).not.toMatch(/style-src [^;]*unsafe-inline/);
    expect(header.match(/unsafe-inline/g)).toHaveLength(1);
    expect(header).not.toContain('unsafe-eval');
  });

  it('relaxes script-src and style-src in development', () => {
    const header = buildCspHeader('abc123', true);
    expect(header).toContain(`script-src 'self' 'nonce-abc123' 'strict-dynamic' 'unsafe-eval'`);
    expect(header).toContain(`style-src 'self' 'unsafe-inline'`);
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
