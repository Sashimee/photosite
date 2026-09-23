import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  RedisRateLimiter,
  type RateLimitRule,
} from '../../common/rate-limit/redis-rate-limiter.js';

export type AuthRouteScope =
  | 'sign-in'
  | 'sign-in-totp'
  | 'sign-up'
  | 'password-reset-request'
  | 'password-reset-confirm'
  | 'verify-email'
  | 'verify-email-resend'
  | 'totp-enroll'
  | 'totp-verify'
  | 'totp-disable';

interface ScopeRules {
  ip?: RateLimitRule;
  account?: RateLimitRule;
}

const ONE_MINUTE = 60;
const FIFTEEN_MINUTES = 15 * ONE_MINUTE;
const ONE_HOUR = 60 * ONE_MINUTE;

// SECURITY.md "Rate limiting ... per IP and per account" for every auth
// mutation. Contract routes call `auth.api.*` directly with no `Request`,
// so Better Auth's own router-level limiter never runs for them (see
// docs/DECISIONS.md D21) — this is the sole rate limit on those routes.
export const AUTH_ROUTE_RULES: Record<AuthRouteScope, ScopeRules> = {
  'sign-in': {
    ip: { windowSeconds: ONE_MINUTE, max: 5 },
    account: { windowSeconds: FIFTEEN_MINUTES, max: 5 },
  },
  'sign-in-totp': {
    ip: { windowSeconds: ONE_MINUTE, max: 5 },
    account: { windowSeconds: FIFTEEN_MINUTES, max: 5 },
  },
  'sign-up': { ip: { windowSeconds: ONE_HOUR, max: 5 } },
  'password-reset-request': {
    ip: { windowSeconds: ONE_HOUR, max: 10 },
    account: { windowSeconds: ONE_HOUR, max: 3 },
  },
  'password-reset-confirm': { ip: { windowSeconds: ONE_HOUR, max: 10 } },
  'verify-email': { ip: { windowSeconds: ONE_HOUR, max: 10 } },
  'verify-email-resend': {
    ip: { windowSeconds: ONE_HOUR, max: 10 },
    account: { windowSeconds: ONE_HOUR, max: 3 },
  },
  'totp-enroll': { account: { windowSeconds: ONE_MINUTE, max: 5 } },
  'totp-verify': { account: { windowSeconds: ONE_MINUTE, max: 5 } },
  'totp-disable': { account: { windowSeconds: ONE_MINUTE, max: 5 } },
};

@Injectable()
export class AuthRateLimitService {
  constructor(@Inject(RedisRateLimiter) private readonly limiter: RedisRateLimiter) {}

  async enforce(scope: AuthRouteScope, ip: string | undefined, accountKey?: string): Promise<void> {
    const rules = AUTH_ROUTE_RULES[scope];

    if (rules.ip) {
      const result = await this.limiter.consume(`auth:${scope}:ip`, ip ?? 'unknown', rules.ip);
      if (!result.allowed) {
        this.throwTooManyRequests(result.retryAfterSeconds);
      }
    }

    if (rules.account && accountKey) {
      const result = await this.limiter.consume(`auth:${scope}:account`, accountKey, rules.account);
      if (!result.allowed) {
        this.throwTooManyRequests(result.retryAfterSeconds);
      }
    }
  }

  // Only the account counter is cleared on success: clearing the IP counter
  // would let one valid account reset the limit for guesses against others.
  async resetAccount(scope: AuthRouteScope, accountKey: string): Promise<void> {
    await this.limiter.reset(`auth:${scope}:account`, accountKey);
  }

  private throwTooManyRequests(retryAfterSeconds: number): never {
    throw new HttpException(
      {
        code: 'TOO_MANY_REQUESTS',
        message: 'Too many attempts. Try again later.',
        details: { retryAfterSeconds },
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
