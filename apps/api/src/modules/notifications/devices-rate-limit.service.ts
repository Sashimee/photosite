import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  RedisRateLimiter,
  type RateLimitRule,
} from '../../common/rate-limit/redis-rate-limiter.js';

const ONE_HOUR = 60 * 60;

const REGISTER_ACCOUNT_RULE: RateLimitRule = { windowSeconds: ONE_HOUR, max: 20 };
const REGISTER_IP_RULE: RateLimitRule = { windowSeconds: ONE_HOUR, max: 60 };

@Injectable()
export class DevicesRateLimitService {
  constructor(@Inject(RedisRateLimiter) private readonly limiter: RedisRateLimiter) {}

  async enforceRegister(ip: string | undefined, accountId: string): Promise<void> {
    await this.enforce('devices:register:ip', ip ?? 'unknown', REGISTER_IP_RULE);
    await this.enforce('devices:register:account', accountId, REGISTER_ACCOUNT_RULE);
  }

  private async enforce(scope: string, key: string, rule: RateLimitRule): Promise<void> {
    const result = await this.limiter.consume(scope, key, rule);
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
