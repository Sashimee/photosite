import { test } from '@playwright/test';

import { registerRouteTests } from './assert-page-works.js';
import { SIGNED_IN_PAGES } from './pages.js';

// Runs in the `smoke-authenticated` project: depends on `setup` and reuses
// its storageState, so it needs SEED_USER_PASSWORD (pages.ts,
// auth.setup.ts).
test.describe('signed in as the seeded client', () => {
  registerRouteTests(SIGNED_IN_PAGES);
});
