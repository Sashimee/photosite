import { HttpException } from '@nestjs/common';
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
}

export interface SessionContext {
  user: BetterAuthUserRow;
  headers: Headers;
  session: BetterAuthSessionRow;
}

// Shared by every module that needs to know who is calling (uploads, and
// every controller-level check in auth.controller.ts itself): looks up the
// Better Auth session for the request's cookie/bearer token, or throws 401.
export async function requireSession(auth: Auth, request: FastifyRequest): Promise<SessionContext> {
  const headers = toFetchHeaders(request);
  const session = await auth.api.getSession({ headers });
  if (!session) {
    throw new HttpException({ code: 'UNAUTHORIZED', message: 'Sign in required' }, 401);
  }
  return {
    user: session.user as unknown as BetterAuthUserRow,
    headers,
    session: session.session as unknown as BetterAuthSessionRow,
  };
}
