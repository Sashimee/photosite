import { describe, expect, it } from 'vitest';

import { buildSignInRedirect } from './sign-in-path';

describe('buildSignInRedirect', () => {
  it('returns the bare sign-in path with no pathname or reason', () => {
    expect(buildSignInRedirect(null)).toBe('/sign-in');
    expect(buildSignInRedirect(undefined)).toBe('/sign-in');
  });

  it('preserves a safe pathname as next', () => {
    expect(buildSignInRedirect('/reports')).toBe('/sign-in?next=%2Freports');
  });

  it('drops an unsafe pathname instead of forwarding it', () => {
    expect(buildSignInRedirect('//evil.com')).toBe('/sign-in');
  });

  it('adds the reverify flag', () => {
    expect(buildSignInRedirect('/reports', 'reverify')).toBe('/sign-in?next=%2Freports&reverify=1');
  });

  it('adds the enroll flag with no pathname', () => {
    expect(buildSignInRedirect(null, 'enroll')).toBe('/sign-in?enroll=1');
  });
});
