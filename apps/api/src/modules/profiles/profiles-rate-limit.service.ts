import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  RedisRateLimiter,
  type RateLimitRule,
} from '../../common/rate-limit/redis-rate-limiter.js';

const ONE_MINUTE = 60;

const SEARCH_IP_RULE: RateLimitRule = { windowSeconds: ONE_MINUTE, max: 60 };

@Injectable()
export class ProfilesRateLimitService {
  constructor(@Inject(RedisRateLimiter) private readonly limiter: RedisRateLimiter) {}

  async enforceSearch(ip: string | undefined): Promise<void> {
    const result = await this.limiter.consume(
      'profiles:search:ip',
      ip ?? 'unknown',
      SEARCH_IP_RULE,
    );
    if (!result.allowed) {
      throw new HttpException(
        {
          code: 'TOO_MANY_REQUESTS',
          message: 'Too many search requests. Try again later.',
          details: { retryAfterSeconds: result.retryAfterSeconds },
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }
}
