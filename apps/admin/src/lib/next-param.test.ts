import { describe, expect, it } from 'vitest';

import { sanitizeNextPath } from './next-param';

const FALLBACK = '/en/account';

describe('sanitizeNextPath', () => {
  it('returns the fallback when there is no value', () => {
    expect(sanitizeNextPath(null, FALLBACK)).toBe(FALLBACK);
    expect(sanitizeNextPath(undefined, FALLBACK)).toBe(FALLBACK);
    expect(sanitizeNextPath('', FALLBACK)).toBe(FALLBACK);
  });

  it('accepts a plain same-origin relative path', () => {
    expect(sanitizeNextPath('/en/requests', FALLBACK)).toBe('/en/requests');
  });

  it('accepts a relative path with a query string', () => {
    expect(sanitizeNextPath('/en/requests?tab=quotes', FALLBACK)).toBe('/en/requests?tab=quotes');
  });

  it('rejects a protocol-relative path', () => {
    expect(sanitizeNextPath('//evil.com', FALLBACK)).toBe(FALLBACK);
  });

  it('rejects an absolute URL', () => {
    expect(sanitizeNextPath('https://evil.com', FALLBACK)).toBe(FALLBACK);
    expect(sanitizeNextPath('http://evil.com/en/account', FALLBACK)).toBe(FALLBACK);
  });

  it('rejects a javascript: scheme', () => {
    expect(sanitizeNextPath('javascript:alert(1)', FALLBACK)).toBe(FALLBACK);
  });

  it('rejects the backslash trick', () => {
    expect(sanitizeNextPath('/\\evil.com', FALLBACK)).toBe(FALLBACK);
  });

  it('rejects a backslash anywhere in the path', () => {
    expect(sanitizeNextPath('/en/foo\\bar', FALLBACK)).toBe(FALLBACK);
  });

  it('rejects a path missing the leading slash', () => {
    expect(sanitizeNextPath('en/account', FALLBACK)).toBe(FALLBACK);
  });

  it('rejects a percent-encoded protocol-relative path', () => {
    expect(sanitizeNextPath('/%2F%2Fevil.com', FALLBACK)).toBe(FALLBACK);
  });

  it('rejects a percent-encoded backslash trick', () => {
    expect(sanitizeNextPath('/%5Cevil.com', FALLBACK)).toBe(FALLBACK);
  });

  it('rejects an unparseable percent-encoded value', () => {
    expect(sanitizeNextPath('/%', FALLBACK)).toBe(FALLBACK);
  });

  it('rejects a value with embedded control characters', () => {
    expect(sanitizeNextPath('/%09/evil.com', FALLBACK)).toBe(FALLBACK);
    expect(sanitizeNextPath('/en\naccount', FALLBACK)).toBe(FALLBACK);
  });

  it('does not treat a double-encoded protocol-relative path as unsafe', () => {
    expect(sanitizeNextPath('/%252Fevil.com', FALLBACK)).toBe('/%2Fevil.com');
  });
});
