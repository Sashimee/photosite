import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  RedisRateLimiter,
  type RateLimitRule,
} from '../../common/rate-limit/redis-rate-limiter.js';

const ONE_HOUR = 60 * 60;

// Public and anonymous-capable (docs/steps/1A.11-admin-api.md), so both
// limits matter: the IP rule is the only defence for a signed-out visitor,
// and the account rule keeps one compromised or abusive account from
// flooding the queue regardless of how many IPs it uses.
const REPORTS_IP_RULE: RateLimitRule = { windowSeconds: ONE_HOUR, max: 10 };
const REPORTS_ACCOUNT_RULE: RateLimitRule = { windowSeconds: ONE_HOUR, max: 20 };

@Injectable()
export class ReportsRateLimitService {
  constructor(@Inject(RedisRateLimiter) private readonly limiter: RedisRateLimiter) {}

  async enforce(ip: string | undefined, reporterId: string | null): Promise<void> {
    const ipResult = await this.limiter.consume(
      'reports:create:ip',
      ip ?? 'unknown',
      REPORTS_IP_RULE,
    );
    if (!ipResult.allowed) {
      this.throwTooManyRequests(ipResult.retryAfterSeconds);
    }

    if (reporterId) {
      const accountResult = await this.limiter.consume(
        'reports:create:account',
        reporterId,
        REPORTS_ACCOUNT_RULE,
      );
      if (!accountResult.allowed) {
        this.throwTooManyRequests(accountResult.retryAfterSeconds);
      }
    }
  }

  private throwTooManyRequests(retryAfterSeconds: number): never {
    throw new HttpException(
      {
        code: 'TOO_MANY_REQUESTS',
        message: 'Too many reports. Try again later.',
        details: { retryAfterSeconds },
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
