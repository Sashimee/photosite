import { HttpException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { RedisRateLimiter } from '../../common/rate-limit/redis-rate-limiter.js';
import { PaymentsRateLimitService } from './payments-rate-limit.service.js';

function service(allowed: boolean) {
  const consume = vi.fn().mockResolvedValue({ allowed, retryAfterSeconds: 42 });
  return {
    consume,
    rateLimit: new PaymentsRateLimitService({ consume } as unknown as RedisRateLimiter),
  };
}

describe('PaymentsRateLimitService', () => {
  it('lets allowed requests through under per-user scopes', async () => {
    const { consume, rateLimit } = service(true);
    await rateLimit.enforceCreateAccount('user-1');
    await rateLimit.enforceCreateAccountLink('user-1');
    expect(consume).toHaveBeenNthCalledWith(
      1,
      'payments:stripe-account-create:account',
      'user-1',
      expect.objectContaining({ max: 10 }),
    );
    expect(consume).toHaveBeenNthCalledWith(
      2,
      'payments:stripe-account-link:account',
      'user-1',
      expect.objectContaining({ max: 30 }),
    );
  });

  it.each(['enforceCreateAccount', 'enforceCreateAccountLink'] as const)(
    '%s throws 429 with retryAfterSeconds when the limit is hit',
    async (method) => {
      const { rateLimit } = service(false);
      const error = await rateLimit[method]('user-1').catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(429);
      expect((error as HttpException).getResponse()).toMatchObject({
        code: 'TOO_MANY_REQUESTS',
        details: { retryAfterSeconds: 42 },
      });
    },
  );
});
