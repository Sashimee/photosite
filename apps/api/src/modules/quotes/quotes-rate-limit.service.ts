import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  RedisRateLimiter,
  type RateLimitRule,
} from '../../common/rate-limit/redis-rate-limiter.js';

const ONE_HOUR = 60 * 60;

// The IP rules are looser than the account rules (SECURITY.md "per IP and
// per account"): they catch one source spinning up many accounts, while the
// account rule is the primary defence against a single account's abuse.
const CREATE_IP_RULE: RateLimitRule = { windowSeconds: ONE_HOUR, max: 100 };
const CREATE_ACCOUNT_RULE: RateLimitRule = { windowSeconds: ONE_HOUR, max: 30 };
const DIRECT_CREATE_IP_RULE: RateLimitRule = { windowSeconds: ONE_HOUR, max: 40 };
const DIRECT_CREATE_ACCOUNT_RULE: RateLimitRule = { windowSeconds: ONE_HOUR, max: 10 };

@Injectable()
export class QuotesRateLimitService {
  constructor(@Inject(RedisRateLimiter) private readonly limiter: RedisRateLimiter) {}

  async enforceCreate(ip: string | undefined, accountId: string): Promise<void> {
    await this.enforce('quotes:create:ip', ip ?? 'unknown', CREATE_IP_RULE);
    await this.enforce('quotes:create:account', accountId, CREATE_ACCOUNT_RULE);
  }

  async enforceDirectCreate(ip: string | undefined, accountId: string): Promise<void> {
    await this.enforce('quotes:direct-create:ip', ip ?? 'unknown', DIRECT_CREATE_IP_RULE);
    await this.enforce('quotes:direct-create:account', accountId, DIRECT_CREATE_ACCOUNT_RULE);
  }

  private async enforce(scope: string, key: string, rule: RateLimitRule): Promise<void> {
    const result = await this.limiter.consume(scope, key, rule);
    if (!result.allowed) {
      throw new HttpException(
        {
          code: 'TOO_MANY_REQUESTS',
          message: 'Too many quotes created. Try again later.',
          details: { retryAfterSeconds: result.retryAfterSeconds },
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }
}
