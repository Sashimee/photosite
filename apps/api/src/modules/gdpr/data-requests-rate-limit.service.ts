import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  RedisRateLimiter,
  type RateLimitRule,
} from '../../common/rate-limit/redis-rate-limiter.js';

const ONE_DAY = 24 * 60 * 60;

// One export at a time is already a database guarantee (the partial unique
// index on `(userId, type)` while pending/processing); this is the other
// half - one a day - consumed only when a genuinely new export row is about
// to be created, never on the idempotent "return the existing row" path
// (docs/steps/1A.12-gdpr.md "One export at a time, one a day").
const EXPORT_ACCOUNT_RULE: RateLimitRule = { windowSeconds: ONE_DAY, max: 1 };

@Injectable()
export class DataRequestsRateLimitService {
  constructor(@Inject(RedisRateLimiter) private readonly limiter: RedisRateLimiter) {}

  async enforceExportCreate(userId: string): Promise<void> {
    const result = await this.limiter.consume('gdpr:export:account', userId, EXPORT_ACCOUNT_RULE);
    if (!result.allowed) {
      throw new HttpException(
        {
          code: 'TOO_MANY_REQUESTS',
          message: 'Only one export per 24 hours is allowed.',
          details: { retryAfterSeconds: result.retryAfterSeconds },
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }
}
