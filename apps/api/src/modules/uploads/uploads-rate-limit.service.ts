import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  RedisRateLimiter,
  type RateLimitRule,
} from '../../common/rate-limit/redis-rate-limiter.js';

export type UploadsRouteScope = 'create';

interface ScopeRules {
  ip: RateLimitRule;
  account: RateLimitRule;
}

const ONE_MINUTE = 60;
const ONE_HOUR = 60 * ONE_MINUTE;

// SECURITY.md "Rate limiting ... uploads; per IP and per account". Uploads
// hold storage and clamd scanning capacity, so the limit is on requesting a
// presigned URL (POST /v1/uploads), not on every read of upload status.
export const UPLOADS_ROUTE_RULES: Record<UploadsRouteScope, ScopeRules> = {
  create: {
    ip: { windowSeconds: 10 * ONE_MINUTE, max: 30 },
    account: { windowSeconds: ONE_HOUR, max: 60 },
  },
};

@Injectable()
export class UploadsRateLimitService {
  constructor(@Inject(RedisRateLimiter) private readonly limiter: RedisRateLimiter) {}

  async enforce(
    scope: UploadsRouteScope,
    ip: string | undefined,
    accountKey: string,
  ): Promise<void> {
    const rules = UPLOADS_ROUTE_RULES[scope];

    const ipResult = await this.limiter.consume(`uploads:${scope}:ip`, ip ?? 'unknown', rules.ip);
    if (!ipResult.allowed) {
      this.throwTooManyRequests(ipResult.retryAfterSeconds);
    }

    const accountResult = await this.limiter.consume(
      `uploads:${scope}:account`,
      accountKey,
      rules.account,
    );
    if (!accountResult.allowed) {
      this.throwTooManyRequests(accountResult.retryAfterSeconds);
    }
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
