import { Redis } from 'ioredis';

// #316: apps/api's per-IP auth rate limits (sign-up 5/hour, verify-email
// 10/hour, sign-in 5/minute - auth-rate-limit.service.ts) apply to every
// real HTTP call this suite's fixtures make from the one runner IP, and one
// full e2e run needs more sign-ups than that budget allows. Mirrors
// apps/api/src/modules/auth/auth.integration.test.ts's own
// clearRateLimitKeys key shapes exactly, ported rather than imported across
// the apps/web/apps/api boundary (docs/steps/1B.12-web-e2e.md keeps
// apps/web/e2e out of apps/api/src/testing).
function redisUrl(): string {
  const url = process.env.REDIS_URL;
  if (!url) {
    throw new Error(
      'REDIS_URL is not set - clearAuthRateLimits connects directly to the rate ' +
        "limiter's Redis instance to reset it between e2e tests (see apps/api/.env.example, " +
        'or the e2e CI job env in .github/workflows/ci.yml).',
    );
  }
  return url;
}

// Clears both the request counter (`rate-limit:auth:<scope>:ip:<ip>`) and
// the exponential-backoff lockout (`lockout:auth:<scope>:ip:<ip>`,
// redis-rate-limiter.ts) - the lockout key survives independently of the
// counter once set, so clearing only the counter would still leave a run
// locked out.
export async function clearAuthRateLimits(): Promise<void> {
  const redis = new Redis(redisUrl());
  try {
    const counterKeys = await redis.keys('rate-limit:auth:*');
    const lockoutKeys = await redis.keys('lockout:auth:*');
    const allKeys = [...counterKeys, ...lockoutKeys];
    if (allKeys.length > 0) {
      await redis.del(...allKeys);
    }
  } finally {
    redis.disconnect();
  }
}
