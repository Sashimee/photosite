import { HttpException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { RedisRateLimiter } from '../../common/rate-limit/redis-rate-limiter.js';
import { AdminMutationRateLimitService } from './admin-mutation-rate-limit.service.js';

function service(allowed: boolean) {
  const consume = vi.fn().mockResolvedValue({ allowed, retryAfterSeconds: 42 });
  return {
    consume,
    rateLimit: new AdminMutationRateLimitService({ consume } as unknown as RedisRateLimiter),
  };
}

describe('AdminMutationRateLimitService', () => {
  it('limits per admin under one scope per rule', async () => {
    const { consume, rateLimit } = service(true);
    await rateLimit.enforce('admin-1');
    await rateLimit.enforceDelete('admin-1');
    await rateLimit.enforceMoney('admin-1');
    expect(consume.mock.calls).toEqual([
      ['admin:mutation:admin', 'admin-1', { windowSeconds: 60, max: 30 }],
      ['admin:mutation:delete', 'admin-1', { windowSeconds: 60, max: 5 }],
      ['admin:mutation:money', 'admin-1', { windowSeconds: 600, max: 5 }],
    ]);
  });

  it.each(['enforce', 'enforceDelete', 'enforceMoney'] as const)(
    '%s throws 429 with retryAfterSeconds when the limit is hit',
    async (method) => {
      const { rateLimit } = service(false);
      const error = await rateLimit[method]('admin-1').catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(429);
      expect((error as HttpException).getResponse()).toMatchObject({
        code: 'TOO_MANY_REQUESTS',
        details: { retryAfterSeconds: 42 },
      });
    },
  );
});
