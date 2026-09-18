import { expect, test as setup } from '@playwright/test';

import { AUTH_STATE_PATH } from '../../playwright.config.js';
import { SEED_CLIENT_EMAIL, SIGNED_IN_LOCALE, seedUserPassword } from './pages.js';

// UI sign-in, not a direct API call: Better Auth's cookie name differs
// between local http and every deployed environment (session.ts), and this
// way the captured storage state always matches whatever it actually is.
//
// Pitfall found by hand on the deployed preview: filling and clicking this
// fast enough beats React attaching the form's onSubmit handler, and the
// browser falls back to a plain native GET submit of the current URL -
// email and password included, as a query string. HYDRATION_SETTLE_MS
// guards against that, and the framenavigated listener below turns a
// regression into a loud assertion failure instead of a silent leak.
const HYDRATION_SETTLE_MS = 500;

setup('authenticate as the seeded client', async ({ page }) => {
  const password = seedUserPassword();
  const navigationsWithPassword: string[] = [];
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame() && frame.url().includes(password)) {
      navigationsWithPassword.push(frame.url());
    }
  });

  await page.goto(`/${SIGNED_IN_LOCALE}/sign-in`);
  await page.waitForTimeout(HYDRATION_SETTLE_MS);

  await page.locator('#sign-in-email').fill(SEED_CLIENT_EMAIL);
  await page.locator('#sign-in-password').fill(password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(`**/${SIGNED_IN_LOCALE}/account`);

  expect(navigationsWithPassword, 'password leaked into the URL by a native form submit').toEqual(
    [],
  );

  await page.context().storageState({ path: AUTH_STATE_PATH });
});
