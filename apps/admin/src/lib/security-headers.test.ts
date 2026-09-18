import { describe, expect, it } from 'vitest';

import { buildSecurityHeaders } from './security-headers';

describe('buildSecurityHeaders', () => {
  it('always includes the noindex header', () => {
    expect(buildSecurityHeaders(false)).toContainEqual({
      key: 'X-Robots-Tag',
      value: 'noindex, nofollow',
    });
    expect(buildSecurityHeaders(true)).toContainEqual({
      key: 'X-Robots-Tag',
      value: 'noindex, nofollow',
    });
  });

  it('only adds HSTS in production', () => {
    expect(
      buildSecurityHeaders(false).some((header) => header.key === 'Strict-Transport-Security'),
    ).toBe(false);
    expect(
      buildSecurityHeaders(true).some((header) => header.key === 'Strict-Transport-Security'),
    ).toBe(true);
  });
});
