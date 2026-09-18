import type { FastifyRequest } from 'fastify';
import { describe, expect, it } from 'vitest';
import type { Auth } from './auth-instance.js';
import { hasSessionCredential } from './session.js';

function fakeAuth({ secure = false }: { secure?: boolean } = {}): Auth {
  return {
    options: {
      advanced: {
        cookies: { session_token: { name: 'photoo_session' } },
        useSecureCookies: secure,
      },
      session: {},
    },
  } as unknown as Auth;
}

function fakeRequest(headers: Record<string, string>): FastifyRequest {
  return { headers } as unknown as FastifyRequest;
}

describe('hasSessionCredential', () => {
  it('is false with no cookie and no authorization header', () => {
    expect(hasSessionCredential(fakeAuth(), fakeRequest({}))).toBe(false);
  });

  it('is true when an authorization header is present', () => {
    expect(hasSessionCredential(fakeAuth(), fakeRequest({ authorization: 'Bearer abc' }))).toBe(
      true,
    );
  });

  it('is true when the session cookie is present among other cookies', () => {
    expect(
      hasSessionCredential(
        fakeAuth(),
        fakeRequest({ cookie: 'other=1; photoo_session=abc; more=2' }),
      ),
    ).toBe(true);
  });

  it('is false when only unrelated cookies are present', () => {
    expect(hasSessionCredential(fakeAuth(), fakeRequest({ cookie: 'other=1; more=2' }))).toBe(
      false,
    );
  });

  it('matches the __Secure- prefixed cookie name once useSecureCookies is on', () => {
    expect(
      hasSessionCredential(
        fakeAuth({ secure: true }),
        fakeRequest({ cookie: '__Secure-photoo_session=abc' }),
      ),
    ).toBe(true);
  });
});
