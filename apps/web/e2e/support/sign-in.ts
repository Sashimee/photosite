import { expect, type Page } from '@playwright/test';

const LOCALE = 'en';

// tests/smoke/auth.setup.ts found this by hand on the deployed preview:
// filling and clicking this fast enough beats React attaching the form's
// onSubmit handler, and the browser falls back to a plain native GET submit
// of the current URL - email and password included, as a query string. This
// guard and the framenavigated assertion below reuse that fix rather than
// rediscovering it for a second form.
const HYDRATION_SETTLE_MS = 500;

export async function signInAsUser(page: Page, email: string, password: string): Promise<void> {
  const navigationsWithPassword: string[] = [];
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame() && frame.url().includes(password)) {
      navigationsWithPassword.push(frame.url());
    }
  });

  await page.goto(`/${LOCALE}/sign-in`);
  await page.waitForTimeout(HYDRATION_SETTLE_MS);

  await page.locator('#sign-in-email').fill(email);
  await page.locator('#sign-in-password').fill(password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(`**/${LOCALE}/account`);

  expect(navigationsWithPassword, 'password leaked into the URL by a native form submit').toEqual(
    [],
  );
}
