import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  RedisRateLimiter,
  type RateLimitRule,
} from '../../common/rate-limit/redis-rate-limiter.js';

const ONE_HOUR = 60 * 60;

const REGISTER_ACCOUNT_RULE: RateLimitRule = { windowSeconds: ONE_HOUR, max: 20 };

@Injectable()
export class DevicesRateLimitService {
  constructor(@Inject(RedisRateLimiter) private readonly limiter: RedisRateLimiter) {}

  async enforceRegister(accountId: string): Promise<void> {
    const result = await this.limiter.consume(
      'devices:register:account',
      accountId,
      REGISTER_ACCOUNT_RULE,
    );
    if (!result.allowed) {
      throw new HttpException(
        {
          code: 'TOO_MANY_REQUESTS',
          message: 'Too many devices registered. Try again later.',
          details: { retryAfterSeconds: result.retryAfterSeconds },
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }
}
