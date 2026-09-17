import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  RedisRateLimiter,
  type RateLimitRule,
} from '../../common/rate-limit/redis-rate-limiter.js';

const ONE_HOUR = 60 * 60;

// The IP rule is looser than the account rule (SECURITY.md "per IP and per
// account"): it catches one source spinning up many accounts, while the
// account rule is the primary defence against a single account's abuse.
const CREATE_IP_RULE: RateLimitRule = { windowSeconds: ONE_HOUR, max: 40 };
const CREATE_ACCOUNT_RULE: RateLimitRule = { windowSeconds: ONE_HOUR, max: 10 };

@Injectable()
export class RequestsRateLimitService {
  constructor(@Inject(RedisRateLimiter) private readonly limiter: RedisRateLimiter) {}

  async enforceCreate(ip: string | undefined, accountId: string): Promise<void> {
    const ipResult = await this.limiter.consume(
      'requests:create:ip',
      ip ?? 'unknown',
      CREATE_IP_RULE,
    );
    if (!ipResult.allowed) {
      this.throwTooManyRequests(ipResult.retryAfterSeconds);
    }

    const accountResult = await this.limiter.consume(
      'requests:create:account',
      accountId,
      CREATE_ACCOUNT_RULE,
    );
    if (!accountResult.allowed) {
      this.throwTooManyRequests(accountResult.retryAfterSeconds);
    }
  }

  private throwTooManyRequests(retryAfterSeconds: number): never {
    throw new HttpException(
      {
        code: 'TOO_MANY_REQUESTS',
        message: 'Too many requests created. Try again later.',
        details: { retryAfterSeconds },
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
