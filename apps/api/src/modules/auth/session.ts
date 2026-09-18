import { HttpException } from '@nestjs/common';
import { getCookies } from 'better-auth/cookies';
import type { FastifyRequest } from 'fastify';
import { toFetchHeaders } from './auth-http.js';
import type { Auth } from './auth-instance.js';

export interface BetterAuthUserRow {
  id: string;
  email: string;
  emailVerifiedAt?: string | Date | null;
  locale: string;
  countryCode: string;
  roles: string[];
  status: string;
  twoFactorEnabled?: boolean;
  lastLoginAt?: string | Date | null;
}

export interface BetterAuthSessionRow {
  id: string;
  expiresAt: string | Date;
  twoFactorVerifiedAt?: string | Date | null;
}

export interface SessionContext {
  user: BetterAuthUserRow;
  headers: Headers;
  session: BetterAuthSessionRow;
}

// Looks up the Better Auth session for the request's cookie/bearer token,
// or returns null: for routes that must work signed out (e.g. public
// reporting) but still attribute the action to an account when one is
// present.
export async function getOptionalSession(
  auth: Auth,
  request: FastifyRequest,
): Promise<SessionContext | null> {
  const headers = toFetchHeaders(request);
  const session = await auth.api.getSession({ headers });
  if (!session) {
    return null;
  }
  return {
    user: session.user as unknown as BetterAuthUserRow,
    headers,
    session: session.session as unknown as BetterAuthSessionRow,
  };
}

// Shared by every module that needs to know who is calling (uploads, and
// every controller-level check in auth.controller.ts itself): looks up the
// Better Auth session for the request's cookie/bearer token, or throws 401.
export async function requireSession(auth: Auth, request: FastifyRequest): Promise<SessionContext> {
  const session = await getOptionalSession(auth, request);
  if (!session) {
    throw new HttpException({ code: 'UNAUTHORIZED', message: 'Sign in required' }, 401);
  }
  return session;
}

// `getOptionalSession` returns null both when no credential was sent and
// when one was sent but is invalid or expired; GET /auth/session has to
// treat those two differently (anonymous vs. rejected), so it checks for
// the presence of a credential first, without validating it.
export function hasSessionCredential(auth: Auth, request: FastifyRequest): boolean {
  const authorization = request.headers.authorization;
  if (typeof authorization === 'string' && authorization.trim().length > 0) {
    return true;
  }
  const cookieHeader = request.headers.cookie;
  if (typeof cookieHeader !== 'string' || cookieHeader.length === 0) {
    return false;
  }
  const sessionCookieName = getCookies(auth.options).sessionToken.name;
  return cookieHeader.split(';').some((part) => part.trim().startsWith(`${sessionCookieName}=`));
}
