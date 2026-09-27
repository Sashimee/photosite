import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  RedisRateLimiter,
  type RateLimitRule,
} from '../../common/rate-limit/redis-rate-limiter.js';

const ONE_HOUR = 60 * 60;

const CREATE_ACCOUNT_RULE: RateLimitRule = { windowSeconds: ONE_HOUR, max: 10 };
const CREATE_ACCOUNT_LINK_RULE: RateLimitRule = { windowSeconds: ONE_HOUR, max: 30 };
const REFUND_RULE: RateLimitRule = { windowSeconds: ONE_HOUR, max: 10 };

@Injectable()
export class PaymentsRateLimitService {
  constructor(@Inject(RedisRateLimiter) private readonly limiter: RedisRateLimiter) {}

  async enforceCreateAccount(userId: string): Promise<void> {
    await this.enforce(
      'payments:stripe-account-create:account',
      userId,
      CREATE_ACCOUNT_RULE,
      'Too many payout account requests. Try again later.',
    );
  }

  async enforceCreateAccountLink(userId: string): Promise<void> {
    await this.enforce(
      'payments:stripe-account-link:account',
      userId,
      CREATE_ACCOUNT_LINK_RULE,
      'Too many onboarding links requested. Try again later.',
    );
  }

  async enforceRefund(userId: string): Promise<void> {
    await this.enforce(
      'payments:booking-refund:account',
      userId,
      REFUND_RULE,
      'Too many refund requests. Try again later.',
    );
  }

  private async enforce(
    scope: string,
    key: string,
    rule: RateLimitRule,
    message: string,
  ): Promise<void> {
    const result = await this.limiter.consume(scope, key, rule);
    if (!result.allowed) {
      throw new HttpException(
        {
          code: 'TOO_MANY_REQUESTS',
          message,
          details: { retryAfterSeconds: result.retryAfterSeconds },
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }
}
