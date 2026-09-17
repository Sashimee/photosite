import { Inject, Injectable } from '@nestjs/common';
import { RedisService } from '../../redis/redis.service.js';

export interface RateLimitRule {
  windowSeconds: number;
  max: number;
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

const CONSUME_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('TTL', KEYS[1])
return {count, ttl}
`;

const LOCKOUT_BASE_SECONDS = 30;
const LOCKOUT_MAX_SECONDS = 60 * 60;

// Redis-backed limiter with exponential-backoff lockout (SECURITY.md
// "Account lockout with exponential backoff after repeated failures"): once
// a scope+key goes over its rule, each further attempt doubles the lockout
// window (capped) instead of just re-arming a fixed one. Shared by every
// module that needs rate limiting (auth, uploads, ...); callers namespace
// their own `scope` (e.g. "auth:sign-in:ip", "uploads:create:account") so
// keys from different callers never collide.
@Injectable()
export class RedisRateLimiter {
  constructor(@Inject(RedisService) private readonly redisService: RedisService) {}

  async consume(scope: string, key: string, rule: RateLimitRule): Promise<RateLimitResult> {
    const redis = this.redisService.client;
    const lockoutKey = `lockout:${scope}:${key}`;
    const lockoutTtl = await redis.ttl(lockoutKey);
    if (lockoutTtl > 0) {
      return { allowed: false, retryAfterSeconds: lockoutTtl };
    }

    const counterKey = `rate-limit:${scope}:${key}`;
    const [count, ttl] = (await redis.eval(
      CONSUME_SCRIPT,
      1,
      counterKey,
      String(rule.windowSeconds),
    )) as [number, number];

    if (count <= rule.max) {
      return { allowed: true, retryAfterSeconds: 0 };
    }

    const overflow = count - rule.max;
    const backoffSeconds = Math.min(
      LOCKOUT_BASE_SECONDS * 2 ** (overflow - 1),
      LOCKOUT_MAX_SECONDS,
    );
    await redis.set(lockoutKey, '1', 'EX', backoffSeconds);
    return { allowed: false, retryAfterSeconds: ttl > 0 ? ttl : backoffSeconds };
  }

  async reset(scope: string, key: string): Promise<void> {
    const redis = this.redisService.client;
    await Promise.all([
      redis.del(`rate-limit:${scope}:${key}`),
      redis.del(`lockout:${scope}:${key}`),
    ]);
  }
}
