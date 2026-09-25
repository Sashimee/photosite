import { test as base, expect } from '@playwright/test';

import { clearAuthRateLimits } from './rate-limit.js';

// #316: an autouse fixture, not a `beforeEach`/`afterEach` in each spec or a
// Playwright `globalSetup`. `globalSetup` only resets once per run, which
// doesn't help a single run whose specs collectively exceed the sign-up
// budget; a per-spec `afterEach` can be skipped by a test that crashes
// before it runs, the same "hook a crashed run skips" shape
// docs/steps/1B.12-web-e2e.md already used to reject cleanup hooks. A
// per-test `before` fixture doesn't have that gap: it runs immediately
// before each test regardless of what happened to any earlier test. Every
// e2e spec imports `test`/`expect` from here, not `@playwright/test`.
export const test = base.extend<{ clearAuthRateLimitsBeforeTest: true }>({
  clearAuthRateLimitsBeforeTest: [
    // Playwright statically parses this signature to find fixture
    // dependencies (there are none), so it must be a literal `{}` -
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      await clearAuthRateLimits();
      await use(true);
    },
    { auto: true },
  ],
});

export { expect };
