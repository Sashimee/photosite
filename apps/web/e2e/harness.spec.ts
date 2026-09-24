import { randomUUID } from 'node:crypto';

import { Redis } from 'ioredis';

import { seedConsentCookie } from './fixtures/consent.js';
import { createVerifiedUser } from './fixtures/users.js';
import { waitForLinkInEmail } from './support/mailpit.js';
import { clearAuthRateLimits } from './support/rate-limit.js';
import { signInAsUser } from './support/sign-in.js';
import { expect, test } from './support/test.js';

// Carrier for 1B.12a's own self-checks (docs/steps/1B.12-web-e2e.md task 9),
// not a flow spec: a broken fixture should fail fast and legibly here rather
// than as a confusing failure in every 1B.12b-f spec that depends on it.
test.describe('e2e harness self-checks', () => {
  test('createVerifiedUser produces an account that can sign in', async ({
    page,
    context,
    baseURL,
  }) => {
    if (!baseURL) {
      throw new Error('baseURL is not configured (playwright.config.ts)');
    }

    const { email, password } = await createVerifiedUser('client');
    await seedConsentCookie(context, baseURL);
    await signInAsUser(page, email, password);

    await expect(page).toHaveURL(/\/en\/account$/);
  });

  test('a Mailpit query that never matches times out with the named error, not a bare timeout', async () => {
    const email = `e2e-harness-self-check-${randomUUID()}@photoo.test`;
    const pattern = /this-pattern-will-never-match-a-real-email/;

    await expect(waitForLinkInEmail(email, pattern, 300)).rejects.toThrow(
      `mailpit: no message to ${email} matched ${pattern.toString()} within 300ms`,
    );
  });

  // #316: proves clearAuthRateLimits actually deletes both key shapes
  // redis-rate-limiter.ts writes, not just that it runs without throwing -
  // a stale lockout key would still lock the suite out on its own even with
  // the counter cleared.
  test('clearAuthRateLimits removes both the request counter and the lockout key', async () => {
    if (!process.env.REDIS_URL) {
      throw new Error('REDIS_URL is not set (see apps/api/.env.example)');
    }
    const redis = new Redis(process.env.REDIS_URL);
    const scope = `auth:sign-up-self-check-${randomUUID()}:ip`;
    const counterKey = `rate-limit:${scope}:127.0.0.1`;
    const lockoutKey = `lockout:${scope}:127.0.0.1`;

    try {
      await redis.set(counterKey, '6', 'EX', 3600);
      await redis.set(lockoutKey, '1', 'EX', 3600);

      await clearAuthRateLimits();

      await expect(redis.exists(counterKey)).resolves.toBe(0);
      await expect(redis.exists(lockoutKey)).resolves.toBe(0);
    } finally {
      await redis.del(counterKey, lockoutKey);
      redis.disconnect();
    }
  });
});
