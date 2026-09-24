import { randomUUID } from 'node:crypto';

import type { Page } from '@playwright/test';

import { seedConsentCookie } from './fixtures/consent.js';
import { waitForLinkInEmail } from './support/mailpit.js';
import { signInAsUser } from './support/sign-in.js';
import { expect, test } from './support/test.js';

const LOCALE = 'en';

// tests/smoke/auth.setup.ts and support/sign-in.ts each keep their own copy
// of this guard rather than sharing one across specs (docs/steps/1B.12-web-e2e.md
// "Determinism" decision): filling and submitting a form fast enough beats
// React attaching its onSubmit handler, and the browser falls back to a
// native GET submit with the password in the URL.
const HYDRATION_SETTLE_MS = 500;

interface SignUpCredentials {
  email: string;
  password: string;
}

function freshCredentials(tag: string): SignUpCredentials {
  return {
    email: `e2e-signup-${tag}-${randomUUID()}@photoo.test`,
    password: `e2e-${randomUUID()}`,
  };
}

async function fillSignUpForm(page: Page, { email, password }: SignUpCredentials): Promise<void> {
  await page.goto(`/${LOCALE}/sign-up`);
  await page.waitForTimeout(HYDRATION_SETTLE_MS);

  await page.locator('#sign-up-email').fill(email);
  await page.locator('#sign-up-password').fill(password);
}

async function submitSignUpForm(page: Page, credentials: SignUpCredentials): Promise<void> {
  await fillSignUpForm(page, credentials);
  await page.getByRole('radio', { name: 'Client looking to book a photographer' }).check();
  await page.locator('button[type="submit"]').click();
}

// Mirrors support/sign-in.ts's own password-leak guard: any submit of this
// form is a candidate for the same native-GET-fallback pitfall, not just the
// one that ends in a successful redirect.
async function attemptSignIn(
  page: Page,
  { email, password }: SignUpCredentials,
): Promise<string[]> {
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

  return navigationsWithPassword;
}

test.describe('sign-up, email verification and sign-in', () => {
  test('sign-up, verify via the Mailpit-delivered link, then sign in lands on /account', async ({
    page,
    context,
    browser,
    baseURL,
  }) => {
    if (!baseURL) {
      throw new Error('baseURL is not configured (playwright.config.ts)');
    }

    const credentials = freshCredentials('happy-path');
    await seedConsentCookie(context, baseURL);

    await submitSignUpForm(page, credentials);
    await expect(
      page.getByText('Check your email to verify your account before signing in.'),
    ).toBeVisible();

    const pollStartedAt = Date.now();
    const link = await waitForLinkInEmail(
      credentials.email,
      /https?:\/\/\S*verify-email#token=\S+/,
    );
    // #288: the margin between this and waitForLinkInEmail's own timeout is
    // what decides whether this spec survives a loaded CI runner - logged
    // rather than asserted on, since asserting a duration would just trade
    // one flake source for another.
    console.log(
      `mailpit: verification link received after ${String(Date.now() - pollStartedAt)}ms`,
    );

    await page.goto(link);
    await expect(page.getByText('Your email is verified.')).toBeVisible();

    // Confirming a token itself signs the browser in (verify-email sets a
    // session cookie), so /sign-in would just redirect straight back to
    // /account in this same context - never exercising the sign-in form. A
    // fresh, unauthenticated context is the only way to actually drive a
    // real sign-in call with these credentials afterwards.
    const signInContext = await browser.newContext();
    try {
      const signInPage = await signInContext.newPage();
      await seedConsentCookie(signInContext, baseURL);
      await signInAsUser(signInPage, credentials.email, credentials.password);
      await expect(signInPage).toHaveURL(new RegExp(`/${LOCALE}/account$`));
    } finally {
      await signInContext.close();
    }
  });

  // docs/steps/1B.12-web-e2e.md: "the one path that cannot be skipped" -
  // signing in before the verification link is opened must be refused with
  // the specific EMAIL_NOT_VERIFIED mapping, not a generic error.
  test('signing in before opening the verification link is refused with the unverified-account message', async ({
    page,
    context,
    baseURL,
  }) => {
    if (!baseURL) {
      throw new Error('baseURL is not configured (playwright.config.ts)');
    }

    const credentials = freshCredentials('unverified');
    await seedConsentCookie(context, baseURL);

    await submitSignUpForm(page, credentials);
    await expect(
      page.getByText('Check your email to verify your account before signing in.'),
    ).toBeVisible();

    const navigationsWithPassword = await attemptSignIn(page, credentials);

    await expect(page.getByText('Please verify your email before signing in.')).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/${LOCALE}/sign-in$`));
    expect(navigationsWithPassword, 'password leaked into the URL by a native form submit').toEqual(
      [],
    );
  });

  test('submitting the sign-up form empty shows inline validation without a server round trip', async ({
    page,
    context,
    baseURL,
  }) => {
    if (!baseURL) {
      throw new Error('baseURL is not configured (playwright.config.ts)');
    }

    await seedConsentCookie(context, baseURL);

    const signUpRequests: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/v1/auth/sign-up')) {
        signUpRequests.push(request.url());
      }
    });

    await page.goto(`/${LOCALE}/sign-up`);
    await page.waitForTimeout(HYDRATION_SETTLE_MS);
    await page.locator('button[type="submit"]').click();

    await expect(page.locator('#sign-up-email-error')).toBeVisible();
    await expect(page.locator('#sign-up-password-error')).toBeVisible();
    await expect(page.locator('#sign-up-role-error')).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/${LOCALE}/sign-up$`));
    expect(
      signUpRequests,
      'empty submission must be blocked client-side, before any request',
    ).toEqual([]);
  });

  test('a password under the length rule shows inline validation without a server round trip', async ({
    page,
    context,
    baseURL,
  }) => {
    if (!baseURL) {
      throw new Error('baseURL is not configured (playwright.config.ts)');
    }

    await seedConsentCookie(context, baseURL);

    const signUpRequests: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/v1/auth/sign-up')) {
        signUpRequests.push(request.url());
      }
    });

    const { email } = freshCredentials('short-password');
    await fillSignUpForm(page, { email, password: 'short123' });
    await page.getByRole('radio', { name: 'Client looking to book a photographer' }).check();
    await page.locator('button[type="submit"]').click();

    await expect(page.locator('#sign-up-password-error')).toHaveText('This value is too short.');
    await expect(page.locator('#sign-up-email-error')).toBeHidden();
    await expect(page).toHaveURL(new RegExp(`/${LOCALE}/sign-up$`));
    expect(
      signUpRequests,
      'a too-short password must be blocked client-side, before any request',
    ).toEqual([]);
  });
});
