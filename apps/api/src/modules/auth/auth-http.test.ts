import { describe, expect, it } from 'vitest';
import { readSetCookieValue, withCookie } from './auth-http.js';

function responseWithCookies(...cookies: string[]): Response {
  const headers = new Headers();
  for (const cookie of cookies) {
    headers.append('set-cookie', cookie);
  }
  return new Response(null, { headers });
}

describe('readSetCookieValue', () => {
  it('returns the raw value of the named cookie', () => {
    const response = responseWithCookies(
      'photoo_session=abc; Path=/; HttpOnly',
      'better-auth.two_factor=tok.sig%3D; Max-Age=600; Path=/',
    );
    expect(readSetCookieValue(response, 'better-auth.two_factor')).toBe('tok.sig%3D');
  });

  it('returns undefined when the cookie is absent', () => {
    expect(readSetCookieValue(responseWithCookies('a=b'), 'c')).toBeUndefined();
  });

  it('returns undefined when the cookie is expired to an empty value', () => {
    expect(readSetCookieValue(responseWithCookies('c=; Max-Age=0; Path=/'), 'c')).toBeUndefined();
  });
});

describe('withCookie', () => {
  it('sets the cookie on a request that has none', () => {
    const next = withCookie(new Headers(), 'tf', 'value');
    expect(next?.get('cookie')).toBe('tf=value');
  });

  it('replaces an incoming cookie of the same name and keeps the others', () => {
    const next = withCookie(new Headers({ cookie: 'tf=stale; other=1' }), 'tf', 'fresh');
    expect(next?.get('cookie')).toBe('other=1; tf=fresh');
  });

  it('does not mutate the input headers', () => {
    const headers = new Headers({ cookie: 'tf=stale' });
    withCookie(headers, 'tf', 'fresh');
    expect(headers.get('cookie')).toBe('tf=stale');
  });

  it.each(['a;b=c', 'a b', 'a,b'])('refuses a value that could inject cookies: %s', (value) => {
    expect(withCookie(new Headers(), 'tf', value)).toBeNull();
  });
});
