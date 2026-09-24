import { randomUUID } from 'node:crypto';

import { expect, test } from '@playwright/test';

import { seedConsentCookie } from './fixtures/consent.js';
import { createVerifiedUser } from './fixtures/users.js';
import { waitForLinkInEmail } from './support/mailpit.js';
import { signInAsUser } from './support/sign-in.js';

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
});
