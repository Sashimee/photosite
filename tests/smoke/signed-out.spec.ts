import { test } from '@playwright/test';

import { registerRouteTests } from './assert-page-works.js';
import { SIGNED_OUT_PAGES } from './pages.js';

// Runs in the `smoke-public` project: no storageState, no `setup`
// dependency, so this half needs no seed credential at all
// (playwright.config.ts).
test.describe('signed out', () => {
  registerRouteTests(SIGNED_OUT_PAGES);
});
