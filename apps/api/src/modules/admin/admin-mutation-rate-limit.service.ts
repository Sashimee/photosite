import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  RedisRateLimiter,
  type RateLimitRule,
} from '../../common/rate-limit/redis-rate-limiter.js';

// Admin reads use the default API limits; only mutations are limited here,
// per admin account, so a compromised admin session can't mass-suspend or
// mass-reassign roles at machine speed (docs/steps/1A.11-admin-api.md).
const ADMIN_MUTATION_RULE: RateLimitRule = { windowSeconds: 60, max: 30 };

// Deletions close the account immediately, so they get a tighter budget than
// other admin mutations.
const ADMIN_DELETE_MUTATION_RULE: RateLimitRule = { windowSeconds: 60, max: 5 };

// Refunds, transfer reversals and the bookings CSV export move or bulk-read
// money, so they share a budget far below the generic mutation limit
// (docs/steps/1D.5-finance.md, 1D.5c).
const ADMIN_MONEY_RULE: RateLimitRule = { windowSeconds: 10 * 60, max: 5 };

@Injectable()
export class AdminMutationRateLimitService {
  constructor(@Inject(RedisRateLimiter) private readonly limiter: RedisRateLimiter) {}

  async enforce(adminId: string): Promise<void> {
    const result = await this.limiter.consume('admin:mutation:admin', adminId, ADMIN_MUTATION_RULE);
    if (!result.allowed) {
      throw new HttpException(
        {
          code: 'TOO_MANY_REQUESTS',
          message: 'Too many admin actions. Try again later.',
          details: { retryAfterSeconds: result.retryAfterSeconds },
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  async enforceDelete(adminId: string): Promise<void> {
    const result = await this.limiter.consume(
      'admin:mutation:delete',
      adminId,
      ADMIN_DELETE_MUTATION_RULE,
    );
    if (!result.allowed) {
      throw new HttpException(
        {
          code: 'TOO_MANY_REQUESTS',
          message: 'Too many deletion requests. Try again later.',
          details: { retryAfterSeconds: result.retryAfterSeconds },
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  async enforceMoney(adminId: string): Promise<void> {
    const result = await this.limiter.consume('admin:mutation:money', adminId, ADMIN_MONEY_RULE);
    if (!result.allowed) {
      throw new HttpException(
        {
          code: 'TOO_MANY_REQUESTS',
          message: 'Too many refunds, reversals or exports. Try again later.',
          details: { retryAfterSeconds: result.retryAfterSeconds },
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }
}
