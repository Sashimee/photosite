import { describe, expect, it } from '@jest/globals';

import { sanitizeReturnPath, signInHref } from './return-path';

describe('sanitizeReturnPath', () => {
  it.each(['/photographers/jane-doe', '/requests/new?photographer=jane-doe', '/quotes/3fa85f64'])(
    'accepts the in-app path %s',
    (path) => {
      expect(sanitizeReturnPath(path)).toBe(path);
    },
  );

  it.each([
    ['an absolute URL', 'https://evil.example/phish'],
    ['an app scheme', 'photoo://photographers/x'],
    ['a protocol-relative path', '//evil.example'],
    ['a backslash path', '/\\evil.example'],
    ['a control character', '/photographers/x\n'],
    ['a relative path', 'photographers/x'],
    ['the sign-in screen', '/sign-in'],
    ['an auth screen with a query', '/two-factor?next=/x'],
    ['an empty value', ''],
  ])('rejects %s', (_label, value) => {
    expect(sanitizeReturnPath(value)).toBeNull();
  });

  it('rejects missing and repeated params', () => {
    expect(sanitizeReturnPath(undefined)).toBeNull();
    expect(sanitizeReturnPath(['/a', '/b'])).toBeNull();
  });
});

describe('signInHref', () => {
  it('carries a safe path as next', () => {
    expect(signInHref('/photographers/jane')).toEqual({
      pathname: '/sign-in',
      params: { next: '/photographers/jane' },
    });
  });

  it('drops an unsafe or root path', () => {
    expect(signInHref('//evil.example')).toBe('/sign-in');
    expect(signInHref('/')).toBe('/sign-in');
    expect(signInHref(null)).toBe('/sign-in');
  });
});
