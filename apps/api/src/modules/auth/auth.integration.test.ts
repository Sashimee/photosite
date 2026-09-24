import { randomUUID } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createPrismaClient, type PrismaClient } from '@photoo/db';
import { Redis } from 'ioredis';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { sha256Hex } from '../../common/crypto/hash.js';
import { createTestApp } from '../../testing/create-test-app.js';
import { waitForLinkInEmail } from '../../testing/mailpit.js';
import { requireIntegrationEnv } from '../../testing/require-integration-env.js';
import { TEST_ENV } from '../../testing/test-env.js';
import { generateTotpCode } from '../../testing/totp.js';
import type { Auth } from './auth-instance.js';
import { AUTH_INSTANCE } from './auth-instance.provider.js';

function extractFragmentToken(link: string): string | null {
  const hashIndex = link.indexOf('#token=');
  if (hashIndex === -1) {
    return null;
  }
  return decodeURIComponent(link.slice(hashIndex + '#token='.length));
}

async function clearRateLimitKeys(redis: Redis): Promise<void> {
  const keys = await redis.keys('rate-limit:auth:*');
  const lockoutKeys = await redis.keys('lockout:auth:*');
  const all = [...keys, ...lockoutKeys];
  if (all.length > 0) {
    await redis.del(...all);
  }
}

const testEnv = requireIntegrationEnv(['TEST_DATABASE_URL', 'REDIS_URL']);

const SEED_USER_PASSWORD = process.env.SEED_USER_PASSWORD ?? 'correct-horse-battery-staple';
// Not "correct horse battery staple": that XKCD phrase is itself in the HIBP
// breach corpus, and the fail-open HIBP check (password.ts) correctly rejects
// it on sign-up.
const PASSWORD = `photoo-test-${randomUUID()}`;

function uniqueEmail(label: string): string {
  return `auth-${label}-${randomUUID()}@photoo.test`;
}

interface ApiErrorBody {
  code: string;
  message: string;
  requestId: string;
}

describe('auth integration', () => {
  if (!testEnv) {
    it.skip('skipped: TEST_DATABASE_URL or REDIS_URL is not set', () => undefined);
    return;
  }

  let app: NestFastifyApplication;
  let prisma: PrismaClient;
  let redis: Redis;
  let auth: Auth;
  const createdEmails: string[] = [];

  beforeAll(async () => {
    app = await createTestApp({
      ...TEST_ENV,
      DATABASE_URL: testEnv.TEST_DATABASE_URL,
      REDIS_URL: testEnv.REDIS_URL,
    });
    prisma = createPrismaClient(testEnv.TEST_DATABASE_URL);
    redis = new Redis(testEnv.REDIS_URL);
    auth = app.get<Auth>(AUTH_INSTANCE);
    await clearRateLimitKeys(redis);
  });

  afterEach(async () => {
    await clearRateLimitKeys(redis);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { in: createdEmails } } });
    // Signing in as the seed user (below) creates real Session rows against
    // a user this suite doesn't own; clean those up too so repeated local
    // runs don't accumulate sessions on client@photoo.test forever.
    await prisma.session.deleteMany({ where: { user: { email: 'client@photoo.test' } } });
    await prisma.$disconnect();
    redis.disconnect();
    await app.close();
  });

  function fastify() {
    return app.getHttpAdapter().getInstance();
  }

  async function signUp(email: string, password = PASSWORD) {
    createdEmails.push(email);
    return fastify().inject({
      method: 'POST',
      url: '/v1/auth/sign-up',
      payload: { email, password, roles: ['client'], locale: 'en' },
    });
  }

  async function verifyByEmail(email: string) {
    const link = await waitForLinkInEmail(email, /https?:\/\/\S*verify-email#token=\S+/);
    const token = extractFragmentToken(link);
    if (!token) {
      throw new Error(`no token found in verification link: ${link}`);
    }
    return fastify().inject({ method: 'POST', url: '/v1/auth/verify-email', payload: { token } });
  }

  it('signs up, verifies by email, signs in with a cookie, reads the session, signs out', async () => {
    const email = uniqueEmail('flow');

    const signUpResponse = await signUp(email);
    expect(signUpResponse.statusCode).toBe(201);
    const signUpBody = signUpResponse.json<{ user: { email: string; emailVerifiedAt: null } }>();
    expect(signUpBody.user.email).toBe(email);
    expect(signUpBody.user.emailVerifiedAt).toBeNull();

    const verifyResponse = await verifyByEmail(email);
    expect(verifyResponse.statusCode).toBe(200);
    const verifyBody = verifyResponse.json<{ user: { emailVerifiedAt: string | null } }>();
    expect(verifyBody.user.emailVerifiedAt).not.toBeNull();

    const signInResponse = await fastify().inject({
      method: 'POST',
      url: '/v1/auth/sign-in',
      payload: { email, password: PASSWORD },
    });
    expect(signInResponse.statusCode).toBe(200);
    const signInBody = signInResponse.json<{
      user: { email: string };
      session: { token: string };
    }>();
    expect(signInBody.user.email).toBe(email);
    expect(signInBody.session.token).toBeTruthy();

    const sessionCookie = signInResponse.cookies.find((cookie) => cookie.name === 'photoo_session');
    expect(sessionCookie).toBeDefined();
    expect(sessionCookie?.httpOnly).toBe(true);
    expect(String(sessionCookie?.sameSite).toLowerCase()).toBe('lax');
    expect(sessionCookie?.secure).toBeFalsy();

    const sessionRow = await prisma.session.findFirst({
      where: { user: { email } },
      orderBy: { createdAt: 'desc' },
    });
    expect(sessionRow?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(sessionRow?.tokenHash).not.toBe(signInBody.session.token);

    if (!sessionCookie) {
      throw new Error('expected a photoo_session cookie on the sign-in response');
    }
    const cookieHeader = `${sessionCookie.name}=${sessionCookie.value}`;
    const sessionByCookie = await fastify().inject({
      method: 'GET',
      url: '/v1/auth/session',
      headers: { cookie: cookieHeader, origin: 'http://localhost:3000' },
    });
    expect(sessionByCookie.statusCode).toBe(200);
    expect(sessionByCookie.json<{ user: { email: string } }>().user.email).toBe(email);

    const sessionByBearer = await fastify().inject({
      method: 'GET',
      url: '/v1/auth/session',
      headers: { authorization: `Bearer ${signInBody.session.token}` },
    });
    expect(sessionByBearer.statusCode).toBe(200);
    expect(sessionByBearer.json<{ user: { email: string } }>().user.email).toBe(email);

    const signOutResponse = await fastify().inject({
      method: 'POST',
      url: '/v1/auth/sign-out',
      headers: { cookie: cookieHeader, origin: 'http://localhost:3000' },
    });
    expect(signOutResponse.statusCode).toBe(204);

    const afterSignOut = await fastify().inject({
      method: 'GET',
      url: '/v1/auth/session',
      headers: { cookie: cookieHeader, origin: 'http://localhost:3000' },
    });
    expect(afterSignOut.statusCode).toBe(401);
  }, 20_000);

  it('GET /auth/session distinguishes anonymous, authenticated and rejected callers', async () => {
    const anonymous = await fastify().inject({ method: 'GET', url: '/v1/auth/session' });
    expect(anonymous.statusCode).toBe(200);
    expect(anonymous.json<{ user: null }>()).toEqual({ user: null });

    const email = uniqueEmail('session-shape');
    await signUp(email);
    await verifyByEmail(email);
    const signInResponse = await fastify().inject({
      method: 'POST',
      url: '/v1/auth/sign-in',
      payload: { email, password: PASSWORD },
    });
    const { session } = signInResponse.json<{ session: { token: string } }>();

    const authenticated = await fastify().inject({
      method: 'GET',
      url: '/v1/auth/session',
      headers: { authorization: `Bearer ${session.token}` },
    });
    expect(authenticated.statusCode).toBe(200);
    expect(authenticated.json<{ user: { email: string } }>().user.email).toBe(email);

    const invalidBearer = await fastify().inject({
      method: 'GET',
      url: '/v1/auth/session',
      headers: { authorization: 'Bearer not-a-real-token' },
    });
    expect(invalidBearer.statusCode).toBe(401);

    const invalidCookie = await fastify().inject({
      method: 'GET',
      url: '/v1/auth/session',
      headers: { cookie: 'photoo_session=not-a-real-token' },
    });
    expect(invalidCookie.statusCode).toBe(401);
  }, 20_000);

  it('rejects sign-in with the wrong password', async () => {
    const email = uniqueEmail('wrong-password');
    await signUp(email);
    await verifyByEmail(email);

    const response = await fastify().inject({
      method: 'POST',
      url: '/v1/auth/sign-in',
      payload: { email, password: 'not-the-right-password' },
    });
    expect(response.statusCode).toBe(401);
  }, 20_000);

  it('blocks sign-in before the email is verified', async () => {
    const email = uniqueEmail('unverified');
    await signUp(email);

    const response = await fastify().inject({
      method: 'POST',
      url: '/v1/auth/sign-in',
      payload: { email, password: PASSWORD },
    });
    expect(response.statusCode).toBe(403);
  }, 20_000);

  describe('POST /v1/auth/verify-email/resend (#290)', () => {
    it('sends a second, independently valid verification link that also verifies the account', async () => {
      const email = uniqueEmail('resend');
      await signUp(email);

      const response = await fastify().inject({
        method: 'POST',
        url: '/v1/auth/verify-email/resend',
        payload: { email },
      });
      expect(response.statusCode).toBe(202);

      const link = await waitForLinkInEmail(email, /https?:\/\/\S*verify-email#token=\S+/);
      const token = extractFragmentToken(link);
      if (!token) {
        throw new Error(`no token found in verification link: ${link}`);
      }
      const verifyResponse = await fastify().inject({
        method: 'POST',
        url: '/v1/auth/verify-email',
        payload: { token },
      });
      expect(verifyResponse.statusCode).toBe(200);

      const user = await prisma.user.findUniqueOrThrow({ where: { email } });
      expect(user.emailVerifiedAt).not.toBeNull();
    }, 20_000);

    it('returns 202 for an email that has never signed up, same as a real one (no enumeration)', async () => {
      const response = await fastify().inject({
        method: 'POST',
        url: '/v1/auth/verify-email/resend',
        payload: { email: uniqueEmail('never-registered-resend') },
      });
      expect(response.statusCode).toBe(202);
    });

    it('returns 202 for an already-verified email without erroring', async () => {
      const email = uniqueEmail('resend-already-verified');
      await signUp(email);
      await verifyByEmail(email);

      const response = await fastify().inject({
        method: 'POST',
        url: '/v1/auth/verify-email/resend',
        payload: { email },
      });
      expect(response.statusCode).toBe(202);
    }, 20_000);

    it('rate limits repeated resend requests for the same account', async () => {
      const email = uniqueEmail('resend-rate-limit');
      await signUp(email);

      let last;
      for (let i = 0; i < 3; i += 1) {
        last = await fastify().inject({
          method: 'POST',
          url: '/v1/auth/verify-email/resend',
          payload: { email },
        });
        expect(last.statusCode).toBe(202);
      }
      const fourth = await fastify().inject({
        method: 'POST',
        url: '/v1/auth/verify-email/resend',
        payload: { email },
      });
      expect(fourth.statusCode).toBe(429);
    }, 20_000);
  });

  it('resets a forgotten password end to end', async () => {
    const email = uniqueEmail('reset');
    await signUp(email);
    await verifyByEmail(email);

    const signInBeforeReset = await fastify().inject({
      method: 'POST',
      url: '/v1/auth/sign-in',
      payload: { email, password: PASSWORD },
    });
    const { session: sessionBeforeReset } = signInBeforeReset.json<{
      session: { token: string };
    }>();

    const requestResponse = await fastify().inject({
      method: 'POST',
      url: '/v1/auth/password-reset/request',
      payload: { email },
    });
    expect(requestResponse.statusCode).toBe(202);

    const link = await waitForLinkInEmail(email, /https?:\/\/\S*reset-password#token=\S+/);
    const token = extractFragmentToken(link);
    expect(token).toBeTruthy();

    const newPassword = `photoo-test-new-${randomUUID()}`;
    const confirmResponse = await fastify().inject({
      method: 'POST',
      url: '/v1/auth/password-reset/confirm',
      payload: { token, password: newPassword },
    });
    expect(confirmResponse.statusCode).toBe(200);

    const sessionAfterReset = await fastify().inject({
      method: 'GET',
      url: '/v1/auth/session',
      headers: { authorization: `Bearer ${sessionBeforeReset.token}` },
    });
    expect(sessionAfterReset.statusCode).toBe(401);

    const oldPasswordSignIn = await fastify().inject({
      method: 'POST',
      url: '/v1/auth/sign-in',
      payload: { email, password: PASSWORD },
    });
    expect(oldPasswordSignIn.statusCode).toBe(401);

    const newPasswordSignIn = await fastify().inject({
      method: 'POST',
      url: '/v1/auth/sign-in',
      payload: { email, password: newPassword },
    });
    expect(newPasswordSignIn.statusCode).toBe(200);
  }, 20_000);

  it('adds a role and records an AuditLog row', async () => {
    const email = uniqueEmail('roles');
    await signUp(email);
    await verifyByEmail(email);
    const signInResponse = await fastify().inject({
      method: 'POST',
      url: '/v1/auth/sign-in',
      payload: { email, password: PASSWORD },
    });
    const { session } = signInResponse.json<{ session: { token: string } }>();

    const addRoleResponse = await fastify().inject({
      method: 'POST',
      url: '/v1/auth/roles',
      headers: { authorization: `Bearer ${session.token}` },
      payload: { role: 'photographer' },
    });
    expect(addRoleResponse.statusCode).toBe(200);
    const body = addRoleResponse.json<{ user: { roles: string[] } }>();
    expect(body.user.roles.sort()).toEqual(['client', 'photographer']);

    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    const auditRow = await prisma.auditLog.findFirst({
      where: { targetType: 'User', targetId: user.id, action: 'user.role_added' },
    });
    expect(auditRow).not.toBeNull();
    expect(auditRow?.after).toEqual({ roles: ['client', 'photographer'] });

    const duplicateResponse = await fastify().inject({
      method: 'POST',
      url: '/v1/auth/roles',
      headers: { authorization: `Bearer ${session.token}` },
      payload: { role: 'photographer' },
    });
    expect(duplicateResponse.statusCode).toBe(409);
  }, 20_000);

  it('enrolls, verifies and disables TOTP', async () => {
    const email = uniqueEmail('totp');
    await signUp(email);
    await verifyByEmail(email);
    const signInResponse = await fastify().inject({
      method: 'POST',
      url: '/v1/auth/sign-in',
      payload: { email, password: PASSWORD },
    });
    const initialCookie = signInResponse.cookies.find((cookie) => cookie.name === 'photoo_session');
    if (!initialCookie) {
      throw new Error('expected a photoo_session cookie on the sign-in response');
    }
    let cookieHeader = `${initialCookie.name}=${initialCookie.value}`;

    const enrollResponse = await fastify().inject({
      method: 'POST',
      url: '/v1/auth/totp/enroll',
      headers: { cookie: cookieHeader, origin: 'http://localhost:3000' },
      payload: { password: PASSWORD },
    });
    expect(enrollResponse.statusCode).toBe(200);
    const { secret, otpauthUrl } = enrollResponse.json<{ secret: string; otpauthUrl: string }>();
    expect(secret).toBeTruthy();
    expect(otpauthUrl).toContain('otpauth://');

    const twoFactorRow = await prisma.twoFactor.findFirstOrThrow({
      where: { user: { email } },
    });
    expect(twoFactorRow.secret).not.toContain(secret);

    const verifyTotpResponse = await fastify().inject({
      method: 'POST',
      url: '/v1/auth/totp/verify',
      headers: { cookie: cookieHeader, origin: 'http://localhost:3000' },
      payload: { code: generateTotpCode(secret) },
    });
    expect(verifyTotpResponse.statusCode).toBe(200);
    expect(
      verifyTotpResponse.json<{ user: { twoFactorEnabled: boolean } }>().user.twoFactorEnabled,
    ).toBe(true);
    const rotatedCookie = verifyTotpResponse.cookies.find(
      (cookie) => cookie.name === 'photoo_session',
    );
    if (rotatedCookie) {
      cookieHeader = `${rotatedCookie.name}=${rotatedCookie.value}`;
    }

    const disableResponse = await fastify().inject({
      method: 'POST',
      url: '/v1/auth/totp/disable',
      headers: { cookie: cookieHeader, origin: 'http://localhost:3000' },
      payload: { code: generateTotpCode(secret), password: PASSWORD },
    });
    expect(disableResponse.statusCode).toBe(200);
    expect(
      disableResponse.json<{ user: { twoFactorEnabled: boolean } }>().user.twoFactorEnabled,
    ).toBe(false);
  }, 20_000);

  it('rate limits repeated bad sign-ins with a 429 ApiError', async () => {
    const email = uniqueEmail('rate-limit');
    let last;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      last = await fastify().inject({
        method: 'POST',
        url: '/v1/auth/sign-in',
        payload: { email, password: 'whatever-wrong-password' },
      });
    }
    expect(last?.statusCode).toBe(429);
    const body = last?.json<ApiErrorBody>();
    expect(body?.code).toBe('TOO_MANY_REQUESTS');
    expect(typeof body?.requestId).toBe('string');
  }, 20_000);

  it('keeps the per-IP sign-in limit when a valid sign-in happens between failed guesses', async () => {
    let failedGuesses = 0;
    let limited = false;
    for (let round = 0; round < 4 && !limited; round += 1) {
      for (let guess = 0; guess < 4; guess += 1) {
        const response = await fastify().inject({
          method: 'POST',
          url: '/v1/auth/sign-in',
          payload: { email: uniqueEmail('victim'), password: 'whatever-wrong-password' },
        });
        if (response.statusCode === 429) {
          limited = true;
          break;
        }
        failedGuesses += 1;
      }
      if (!limited) {
        await fastify().inject({
          method: 'POST',
          url: '/v1/auth/sign-in',
          payload: { email: 'client@photoo.test', password: SEED_USER_PASSWORD },
        });
      }
    }
    expect(limited).toBe(true);
    expect(failedGuesses).toBeLessThanOrEqual(5);
  }, 30_000);

  it('signs in as the seed client user with SEED_USER_PASSWORD', async () => {
    const response = await fastify().inject({
      method: 'POST',
      url: '/v1/auth/sign-in',
      payload: { email: 'client@photoo.test', password: SEED_USER_PASSWORD },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<{ user: { email: string } }>().user.email).toBe('client@photoo.test');
  }, 20_000);

  it('returns a VALIDATION_ERROR ApiError for an unsupported role at sign-up', async () => {
    const response = await fastify().inject({
      method: 'POST',
      url: '/v1/auth/sign-up',
      payload: { email: uniqueEmail('bad'), password: PASSWORD, roles: ['admin'], locale: 'en' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<ApiErrorBody>().code).toBe('VALIDATION_ERROR');
  });

  it('returns a null user for /session without a session, not an error', async () => {
    const response = await fastify().inject({ method: 'GET', url: '/v1/auth/session' });
    expect(response.statusCode).toBe(200);
    expect(response.json<{ user: null }>()).toEqual({ user: null });
  });

  it('returns PROVIDER_NOT_CONFIGURED for an unconfigured OAuth provider', async () => {
    const response = await fastify().inject({
      method: 'GET',
      url: '/v1/auth/oauth/google/start',
    });
    expect(response.statusCode).toBe(404);
    expect(response.json<ApiErrorBody>().code).toBe('PROVIDER_NOT_CONFIGURED');
  });

  // Issue #14: only the OAuth callback route and the contract's own Nest
  // routes are reachable; every other native Better Auth path (previously
  // served by the wildcard catch-all) must 404.
  describe('issue #14: no Better Auth catch-all', () => {
    it.each(['/v1/auth/update-user', '/v1/auth/sign-up/email', '/v1/auth/list-sessions'])(
      'returns 404 for %s',
      async (url) => {
        const response = await fastify().inject({
          method: 'POST',
          url,
          payload: { roles: ['admin'] },
        });
        expect(response.statusCode).toBe(404);
      },
    );

    it('never creates a user with the admin role from a sign-up request', async () => {
      const email = uniqueEmail('no-admin-escalation');
      const response = await fastify().inject({
        method: 'POST',
        url: '/v1/auth/sign-up',
        payload: { email, password: PASSWORD, roles: ['admin'], locale: 'en' },
      });
      expect(response.statusCode).toBe(400);
      const user = await prisma.user.findUnique({ where: { email } });
      expect(user).toBeNull();
    });
  });

  // Issue #15: Redis holds rate-limit counters only, never a raw session
  // token or session/user payload.
  it('issue #15: never stores the raw session token in Redis', async () => {
    const email = uniqueEmail('no-redis-token');
    await signUp(email);
    await verifyByEmail(email);
    const signInResponse = await fastify().inject({
      method: 'POST',
      url: '/v1/auth/sign-in',
      payload: { email, password: PASSWORD },
    });
    const { session } = signInResponse.json<{ session: { token: string } }>();

    const rawValue = await redis.get(session.token);
    expect(rawValue).toBeNull();

    const allKeys = await redis.keys('*');
    for (const key of allKeys) {
      expect(key).not.toContain(session.token);
      const type = await redis.type(key);
      if (type === 'string') {
        const value = await redis.get(key);
        expect(value ?? '').not.toContain(session.token);
      }
    }
  }, 20_000);

  // Issue #16: every auth mutation is Redis-rate-limited per IP, and
  // cookie-authenticated state changes require a same-origin Origin header.
  describe('issue #16: rate limiting and origin checks', () => {
    it('rate limits repeated password-reset requests', async () => {
      let last;
      for (let attempt = 0; attempt < 11; attempt += 1) {
        last = await fastify().inject({
          method: 'POST',
          url: '/v1/auth/password-reset/request',
          payload: { email: uniqueEmail(`reset-flood-${String(attempt)}`) },
        });
      }
      expect(last?.statusCode).toBe(429);
      expect(last?.json<ApiErrorBody>().code).toBe('TOO_MANY_REQUESTS');
    }, 20_000);

    it('rejects a cookie-authenticated mutation from a cross-site Origin with 403', async () => {
      const email = uniqueEmail('csrf');
      await signUp(email);
      await verifyByEmail(email);
      const signInResponse = await fastify().inject({
        method: 'POST',
        url: '/v1/auth/sign-in',
        payload: { email, password: PASSWORD },
      });
      const cookie = signInResponse.cookies.find((c) => c.name === 'photoo_session');
      if (!cookie) {
        throw new Error('expected a session cookie');
      }
      const response = await fastify().inject({
        method: 'POST',
        url: '/v1/auth/sign-out',
        headers: {
          cookie: `${cookie.name}=${cookie.value}`,
          origin: 'https://evil.example',
        },
      });
      expect(response.statusCode).toBe(403);
    }, 20_000);

    it('rejects a form-encoded content type with 415', async () => {
      const response = await fastify().inject({
        method: 'POST',
        url: '/v1/auth/sign-in',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: 'email=a@example.com&password=x',
      });
      expect(response.statusCode).toBe(415);
    });
  });

  // Issue #17: sign-in never reveals whether an email is registered, and a
  // duplicate sign-up looks identical to a fresh one.
  describe('issue #17: no user enumeration', () => {
    it('returns the same 401 for an unknown email as for a wrong password', async () => {
      const email = uniqueEmail('enum-unknown');
      await signUp(email);
      await verifyByEmail(email);

      const unknownEmailResponse = await fastify().inject({
        method: 'POST',
        url: '/v1/auth/sign-in',
        payload: { email: uniqueEmail('never-registered'), password: 'password1234' },
      });
      const wrongPasswordResponse = await fastify().inject({
        method: 'POST',
        url: '/v1/auth/sign-in',
        payload: { email, password: 'password1234' },
      });

      expect(unknownEmailResponse.statusCode).toBe(401);
      expect(wrongPasswordResponse.statusCode).toBe(401);
      expect(unknownEmailResponse.json<ApiErrorBody>().code).toBe(
        wrongPasswordResponse.json<ApiErrorBody>().code,
      );
    }, 20_000);

    it('returns the same 201 shape for a duplicate sign-up as for a new one', async () => {
      const email = uniqueEmail('duplicate');
      const firstResponse = await signUp(email);
      expect(firstResponse.statusCode).toBe(201);

      const secondResponse = await fastify().inject({
        method: 'POST',
        url: '/v1/auth/sign-up',
        payload: { email, password: PASSWORD, roles: ['client'], locale: 'en' },
      });
      expect(secondResponse.statusCode).toBe(201);
      const body = secondResponse.json<{ user: { id: string; email: string } }>();
      expect(body.user.email).toBe(email);
      expect(body.user.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
    }, 20_000);
  });

  // Backup codes must be stored through our own AES-256-GCM envelope
  // (AUTH_ENCRYPTION_KEY), not Better Auth's default plain/XChaCha storage.
  it('stores TOTP backup codes AES-256-GCM-encrypted with AUTH_ENCRYPTION_KEY', async () => {
    const email = uniqueEmail('backup-codes');
    await signUp(email);
    await verifyByEmail(email);
    const signInResponse = await fastify().inject({
      method: 'POST',
      url: '/v1/auth/sign-in',
      payload: { email, password: PASSWORD },
    });
    const cookie = signInResponse.cookies.find((c) => c.name === 'photoo_session');
    if (!cookie) {
      throw new Error('expected a session cookie');
    }
    const cookieHeader = `${cookie.name}=${cookie.value}`;

    const enrollResponse = await fastify().inject({
      method: 'POST',
      url: '/v1/auth/totp/enroll',
      headers: { cookie: cookieHeader, origin: 'http://localhost:3000' },
      payload: { password: PASSWORD },
    });
    const { backupCodes } = enrollResponse.json<{ backupCodes: string[] }>();
    expect(backupCodes.length).toBeGreaterThan(0);

    const twoFactorRow = await prisma.twoFactor.findFirstOrThrow({ where: { user: { email } } });
    const parts = twoFactorRow.backupCodes.split('.');
    expect(parts).toHaveLength(3);
    const { decryptAesGcm } = await import('@photoo/shared/crypto');
    const decrypted = decryptAesGcm(twoFactorRow.backupCodes, TEST_ENV.AUTH_ENCRYPTION_KEY);
    const decoded = JSON.parse(decrypted) as string[];
    expect(decoded).toEqual(backupCodes);
  }, 20_000);

  // Suspended/deleted users cannot obtain a new session.
  it('blocks sign-in for a suspended user', async () => {
    const email = uniqueEmail('suspended');
    await signUp(email);
    // autoSignInAfterVerification already creates one session here; the
    // assertion below must check that sign-in creates no *additional* one.
    await verifyByEmail(email);
    await prisma.user.update({ where: { email }, data: { status: 'suspended' } });
    const sessionCountBefore = await prisma.session.count({ where: { user: { email } } });

    const response = await fastify().inject({
      method: 'POST',
      url: '/v1/auth/sign-in',
      payload: { email, password: PASSWORD },
    });
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect(response.statusCode).toBeLessThan(500);

    const sessionCountAfter = await prisma.session.count({ where: { user: { email } } });
    expect(sessionCountAfter).toBe(sessionCountBefore);
  }, 20_000);

  // 2FA-enabled sign-in and "log out everywhere".
  describe('2FA sign-in and revoke-all', () => {
    it('requires a TOTP challenge to complete sign-in, then revokes all sessions', async () => {
      const email = uniqueEmail('2fa-signin');
      await signUp(email);
      await verifyByEmail(email);
      const firstSignIn = await fastify().inject({
        method: 'POST',
        url: '/v1/auth/sign-in',
        payload: { email, password: PASSWORD },
      });
      const initialCookie = firstSignIn.cookies.find((c) => c.name === 'photoo_session');
      if (!initialCookie) {
        throw new Error('expected a session cookie');
      }
      let cookieHeader = `${initialCookie.name}=${initialCookie.value}`;

      const enrollResponse = await fastify().inject({
        method: 'POST',
        url: '/v1/auth/totp/enroll',
        headers: { cookie: cookieHeader, origin: 'http://localhost:3000' },
        payload: { password: PASSWORD },
      });
      const { secret } = enrollResponse.json<{ secret: string }>();
      const verifyResponse = await fastify().inject({
        method: 'POST',
        url: '/v1/auth/totp/verify',
        headers: { cookie: cookieHeader, origin: 'http://localhost:3000' },
        payload: { code: generateTotpCode(secret) },
      });
      const rotatedCookie = verifyResponse.cookies.find((c) => c.name === 'photoo_session');
      if (rotatedCookie) {
        cookieHeader = `${rotatedCookie.name}=${rotatedCookie.value}`;
      }

      const secondSignIn = await fastify().inject({
        method: 'POST',
        url: '/v1/auth/sign-in',
        payload: { email, password: PASSWORD },
      });
      expect(secondSignIn.statusCode).toBe(200);
      expect(secondSignIn.json<{ twoFactorRequired?: boolean }>().twoFactorRequired).toBe(true);
      const pendingCookieHeader = secondSignIn.cookies
        .map((cookie) => `${cookie.name}=${cookie.value}`)
        .join('; ');

      const completion = await fastify().inject({
        method: 'POST',
        url: '/v1/auth/sign-in/totp',
        headers: { cookie: pendingCookieHeader, origin: 'http://localhost:3000' },
        payload: { code: generateTotpCode(secret) },
      });
      expect(completion.statusCode).toBe(200);
      const completionBody = completion.json<{
        user: { email: string };
        session: { token: string };
      }>();
      expect(completionBody.user.email).toBe(email);

      const revokeCookie = completion.cookies.find((c) => c.name === 'photoo_session');
      const revokeCookieHeader = revokeCookie
        ? `${revokeCookie.name}=${revokeCookie.value}`
        : cookieHeader;

      const revokeResponse = await fastify().inject({
        method: 'POST',
        url: '/v1/auth/sessions/revoke-all',
        headers: { cookie: revokeCookieHeader, origin: 'http://localhost:3000' },
      });
      expect(revokeResponse.statusCode).toBe(204);

      const afterRevoke = await fastify().inject({
        method: 'GET',
        url: '/v1/auth/session',
        headers: { cookie: revokeCookieHeader },
      });
      expect(afterRevoke.statusCode).toBe(401);
    }, 20_000);

    it('leaves twoFactorVerifiedAt null on a session that never proved a second factor', async () => {
      const email = uniqueEmail('no-2fa-session');
      await signUp(email);
      await verifyByEmail(email);

      const signInResponse = await fastify().inject({
        method: 'POST',
        url: '/v1/auth/sign-in',
        payload: { email, password: PASSWORD },
      });
      const { session } = signInResponse.json<{ session: { token: string } }>();
      const tokenHash = sha256Hex(session.token);
      const sessionRow = await prisma.session.findUniqueOrThrow({ where: { tokenHash } });
      // Same createSession() path an OAuth callback uses (both skip the
      // sign-in/totp and totp/verify handlers that are the only place this
      // field is ever stamped); no configured provider to drive a real
      // OAuth callback in this test environment.
      expect(sessionRow.twoFactorVerifiedAt).toBeNull();
    }, 20_000);

    it('stamps twoFactorVerifiedAt only on the session that completed sign-in/totp', async () => {
      const email = uniqueEmail('stamp-signin-totp');
      await signUp(email);
      await verifyByEmail(email);
      const firstSignIn = await fastify().inject({
        method: 'POST',
        url: '/v1/auth/sign-in',
        payload: { email, password: PASSWORD },
      });
      const initialCookie = firstSignIn.cookies.find((c) => c.name === 'photoo_session');
      if (!initialCookie) {
        throw new Error('expected a session cookie');
      }
      const cookieHeader = `${initialCookie.name}=${initialCookie.value}`;

      const enrollResponse = await fastify().inject({
        method: 'POST',
        url: '/v1/auth/totp/enroll',
        headers: { cookie: cookieHeader, origin: 'http://localhost:3000' },
        payload: { password: PASSWORD },
      });
      const { secret } = enrollResponse.json<{ secret: string }>();
      await fastify().inject({
        method: 'POST',
        url: '/v1/auth/totp/verify',
        headers: { cookie: cookieHeader, origin: 'http://localhost:3000' },
        payload: { code: generateTotpCode(secret) },
      });

      const secondSignIn = await fastify().inject({
        method: 'POST',
        url: '/v1/auth/sign-in',
        payload: { email, password: PASSWORD },
      });
      const pendingCookieHeader = secondSignIn.cookies
        .map((cookie) => `${cookie.name}=${cookie.value}`)
        .join('; ');
      const completion = await fastify().inject({
        method: 'POST',
        url: '/v1/auth/sign-in/totp',
        headers: { cookie: pendingCookieHeader, origin: 'http://localhost:3000' },
        payload: { code: generateTotpCode(secret) },
      });
      expect(completion.statusCode).toBe(200);
      const { session } = completion.json<{ session: { token: string } }>();
      const tokenHash = sha256Hex(session.token);
      const sessionRow = await prisma.session.findUniqueOrThrow({ where: { tokenHash } });
      const { twoFactorVerifiedAt } = sessionRow;
      if (!twoFactorVerifiedAt) {
        throw new Error('expected twoFactorVerifiedAt to be set');
      }
      expect(Date.now() - twoFactorVerifiedAt.getTime()).toBeLessThan(10_000);
    }, 20_000);

    it("revokes the user's other sessions when enabling two-factor", async () => {
      const email = uniqueEmail('2fa-enable-revokes');
      await signUp(email);
      await verifyByEmail(email);

      const firstSignIn = await fastify().inject({
        method: 'POST',
        url: '/v1/auth/sign-in',
        payload: { email, password: PASSWORD },
      });
      const firstCookie = firstSignIn.cookies.find((c) => c.name === 'photoo_session');
      const secondSignIn = await fastify().inject({
        method: 'POST',
        url: '/v1/auth/sign-in',
        payload: { email, password: PASSWORD },
      });
      const secondCookie = secondSignIn.cookies.find((c) => c.name === 'photoo_session');
      if (!firstCookie || !secondCookie) {
        throw new Error('expected a session cookie from both sign-ins');
      }
      const firstCookieHeader = `${firstCookie.name}=${firstCookie.value}`;
      const secondCookieHeader = `${secondCookie.name}=${secondCookie.value}`;

      const beforeEnable = await fastify().inject({
        method: 'GET',
        url: '/v1/auth/session',
        headers: { cookie: secondCookieHeader },
      });
      expect(beforeEnable.statusCode).toBe(200);

      const enrollResponse = await fastify().inject({
        method: 'POST',
        url: '/v1/auth/totp/enroll',
        headers: { cookie: firstCookieHeader, origin: 'http://localhost:3000' },
        payload: { password: PASSWORD },
      });
      const { secret } = enrollResponse.json<{ secret: string }>();
      const verifyResponse = await fastify().inject({
        method: 'POST',
        url: '/v1/auth/totp/verify',
        headers: { cookie: firstCookieHeader, origin: 'http://localhost:3000' },
        payload: { code: generateTotpCode(secret) },
      });
      expect(verifyResponse.statusCode).toBe(200);

      const afterEnable = await fastify().inject({
        method: 'GET',
        url: '/v1/auth/session',
        headers: { cookie: secondCookieHeader },
      });
      expect(afterEnable.statusCode).toBe(401);
    }, 20_000);
  });

  // Issue #127: hardened-adapter.ts used to hash a `where: { token }` value
  // only when it didn't already look like one of its own sha256 hashes, so a
  // hash round-tripped out of a userId-keyed `listSessions` read could be fed
  // straight back in without being mangled by a second hash. That also meant
  // a *stolen* hash (e.g. from a read-only DB leak) could be presented as a
  // bearer token and pass straight through unhashed, authenticating with it
  // directly — trading "revokeOtherSessions silently does nothing" for
  // "a leaked hash is a working session token", which is worse. The fix
  // hashes every token value unconditionally (a stolen hash just gets hashed
  // into something that matches nothing) and never hands back a hash
  // pretending to be a raw token: a session row not looked up by `token`
  // gets `token: null` instead of its stored hash.
  describe('issue #127: hashed session tokens never work as raw ones', () => {
    it("rejects a bearer token that is actually a session's stored hash, not its raw token", async () => {
      const email = uniqueEmail('hash-as-bearer');
      await signUp(email);
      await verifyByEmail(email);

      const signInResponse = await fastify().inject({
        method: 'POST',
        url: '/v1/auth/sign-in',
        payload: { email, password: PASSWORD },
      });
      const { session } = signInResponse.json<{ session: { token: string } }>();
      const stolenHash = sha256Hex(session.token);
      expect(await prisma.session.findUnique({ where: { tokenHash: stolenHash } })).not.toBeNull();

      const asRawBearer = await fastify().inject({
        method: 'GET',
        url: '/v1/auth/session',
        headers: { authorization: `Bearer ${stolenHash}` },
      });
      expect(asRawBearer.statusCode).toBe(401);

      const asRealBearer = await fastify().inject({
        method: 'GET',
        url: '/v1/auth/session',
        headers: { authorization: `Bearer ${session.token}` },
      });
      expect(asRealBearer.statusCode).toBe(200);
    }, 20_000);

    it('redacts the token on a session row not looked up by token, and cannot be tricked into revoking it', async () => {
      const email = uniqueEmail('redact-token');
      await signUp(email);
      await verifyByEmail(email);

      const firstSignIn = await fastify().inject({
        method: 'POST',
        url: '/v1/auth/sign-in',
        payload: { email, password: PASSWORD },
      });
      const secondSignIn = await fastify().inject({
        method: 'POST',
        url: '/v1/auth/sign-in',
        payload: { email, password: PASSWORD },
      });
      const { session: currentSession } = firstSignIn.json<{ session: { token: string } }>();
      const { session: otherSession } = secondSignIn.json<{ session: { token: string } }>();
      const otherTokenHash = sha256Hex(otherSession.token);
      const otherRow = await prisma.session.findUniqueOrThrow({
        where: { tokenHash: otherTokenHash },
      });

      const headers = new Headers({ authorization: `Bearer ${currentSession.token}` });
      const sessions = await auth.api.listSessions({ headers });
      const listedOther = sessions.find((listed) => listed.id === otherRow.id);
      if (!listedOther) {
        throw new Error('expected listSessions to return the other session');
      }
      expect(listedOther.token).toBeNull();

      // better-auth's revokeOtherSessions takes exactly this redacted `null`
      // and hands it to deleteSession, whose own pre-delete lookup swallows
      // whatever the adapter throws (see with-hooks.mjs deleteWithHooks) and
      // treats "not found" as "nothing to delete". So neither session is
      // touched: safely inert, rather than either exploitable (accepting the
      // hash as a credential) or destructively wrong (deleting the wrong
      // session). Application code should keep doing what totpVerify already
      // does (auth.controller.ts) and revoke by userId/id directly instead
      // of relying on this helper.
      const result = await auth.api.revokeOtherSessions({ headers });
      expect(result.status).toBe(true);
      expect(
        await prisma.session.findUnique({ where: { tokenHash: otherTokenHash } }),
      ).not.toBeNull();
      const currentTokenHash = sha256Hex(currentSession.token);
      expect(
        await prisma.session.findUnique({ where: { tokenHash: currentTokenHash } }),
      ).not.toBeNull();
    }, 20_000);
  });
});
