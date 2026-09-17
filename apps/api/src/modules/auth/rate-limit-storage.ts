import type { BetterAuthRateLimitStorage } from 'better-auth';
import { RedisRateLimiter } from '../../common/rate-limit/redis-rate-limiter.js';

// Better Auth's own rate limiter only runs inside its HTTP router (see D21),
// which today only handles `/v1/auth/callback/:provider`. It still needs a
// distributed store rather than in-memory, hence Redis via the same
// INCR+EXPIRE primitive the Nest-side limiter uses (issue #15: no
// `secondaryStorage`, so Redis holds counters only, never session data).
export function createRedisRateLimitStorage(limiter: RedisRateLimiter): BetterAuthRateLimitStorage {
  return {
    consume: async (key, rule) => {
      const result = await limiter.consume('auth:better-auth', key, {
        windowSeconds: rule.window,
        max: rule.max,
      });
      return {
        allowed: result.allowed,
        retryAfter: result.allowed ? null : result.retryAfterSeconds,
      };
    },
  };
}
