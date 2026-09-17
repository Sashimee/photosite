import { HttpException } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { Auth } from '../../modules/auth/auth-instance.js';
import { requireSession, type SessionContext } from '../../modules/auth/session.js';

// How long a session's 2FA verification stays usable for admin routes
// before it must be re-proven: long enough for a single admin session
// (SECURITY.md's 12h admin session lifetime), short enough that a stolen
// long-lived session can't reuse an old TOTP check indefinitely.
const TWO_FACTOR_VERIFICATION_WINDOW_MS = 12 * 60 * 60 * 1000;

function forbidden(message: string): HttpException {
  return new HttpException({ code: 'FORBIDDEN', message }, 403);
}

// Distinct from the plain FORBIDDEN above so the admin UI can tell "you're
// not an admin" (dead end) apart from "prove your second factor again"
// (re-prompt for TOTP), without parsing the message string. 403 stays the
// HTTP status since the caller is authenticated, just not authorized yet.
function twoFactorRequired(message: string): HttpException {
  return new HttpException({ code: 'TWO_FACTOR_REQUIRED', message }, 403);
}

// The admin API's guard (docs/steps/1A.9-verification.md "Admin review"):
// role admin plus a session that itself proved a second factor within the
// window above. `twoFactorVerifiedAt` is stamped per-session only by
// sign-in/totp and totp/verify (apps/api/src/modules/auth/auth.controller.ts),
// never by account-level `twoFactorEnabled`, so a password-only session
// predating enrolment and an OAuth callback session (neither ever stamped)
// are both refused rather than inheriting admin access.
export async function requireAdminSession(
  auth: Auth,
  request: FastifyRequest,
): Promise<SessionContext> {
  const session = await requireSession(auth, request);
  if (!session.user.roles.includes('admin')) {
    throw forbidden('admin role required');
  }
  const verifiedAt = session.session.twoFactorVerifiedAt;
  if (!verifiedAt) {
    throw twoFactorRequired('admin session requires a verified second factor');
  }
  const verifiedAtMs = new Date(verifiedAt).getTime();
  if (Date.now() - verifiedAtMs > TWO_FACTOR_VERIFICATION_WINDOW_MS) {
    throw twoFactorRequired('admin session two-factor verification has expired');
  }
  return session;
}
