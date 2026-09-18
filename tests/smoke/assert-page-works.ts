import { expect, test, type Page, type Request } from '@playwright/test';

import type { SmokePage } from './pages.js';

// apps/web/src/app/[locale]/error.tsx, web.error.title (packages/i18n).
// Matched against innerText, not textContent: the same string also sits
// inside the RSC payload embedded in a <script> tag, and textContent (or
// the raw HTML) reads that too, which is a false positive on a page that
// never actually rendered the error boundary.
const ERROR_BOUNDARY_TEXT = 'Something went wrong';

// Deliberately empty; an addition without a comment justifying the specific
// message is a silenced bug, not an allow-list entry.
const CONSOLE_ERROR_ALLOWLIST: readonly RegExp[] = [];

// Non-zero only in deploy-preview.yml's post-deploy job: that traffic shape
// against footoo.bas.lu got a workstation IP banned by CrowdSec once already.
const NAV_DELAY_MS = Number(process.env.SMOKE_NAV_DELAY_MS ?? 0);

// `waitUntil: 'networkidle'` is not used here: a next/link prefetch fetch to
// a route that 404s never reaches Chrome's `loadingFinished`/`loadingFailed`
// (confirmed via the CDP Network domain), so networkidle hangs to the test
// timeout on any page whose nav links to a route that doesn't exist yet -
// exactly the kind of thing this suite exists to surface, not hide behind a
// wait condition. `load` plus this settle window is enough for the console
// errors and page errors those failed prefetches and hydration produce.
const SETTLE_MS = 1000;

export async function assertPageWorks(page: Page, baseURL: string | undefined, path: string) {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const failedSameOriginRequests: string[] = [];
  const targetOrigin = new URL(path, baseURL).origin;

  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() !== 'error') {
      return;
    }
    const text = message.text();
    if (CONSOLE_ERROR_ALLOWLIST.some((pattern) => pattern.test(text))) {
      return;
    }
    consoleErrors.push(text);
  });
  page.on('requestfailed', (request: Request) => {
    if (new URL(request.url()).origin !== targetOrigin) {
      return;
    }
    const errorText = request.failure()?.errorText ?? 'unknown';
    // Every `?_rsc=` (Link prefetch) request on every page shows this exact
    // pattern via the CDP Network domain: sent, then aborted within ~10ms,
    // no response either way, on both requests for the same href. That is
    // the App Router's own prefetch de-duplication, present on a healthy
    // page, not a broken resource. Every other error code (refused, reset,
    // name-not-resolved, blocked-by-client, ...) still fails the check.
    if (errorText === 'net::ERR_ABORTED' && request.url().includes('_rsc=')) {
      return;
    }
    failedSameOriginRequests.push(`${request.url()} - ${errorText}`);
  });

  if (NAV_DELAY_MS > 0) {
    await page.waitForTimeout(NAV_DELAY_MS);
  }

  await page.goto(path);
  await page.waitForTimeout(SETTLE_MS);

  const bodyText = await page.locator('body').innerText();

  expect(pageErrors, 'uncaught page error').toEqual([]);
  expect(consoleErrors, 'console.error message').toEqual([]);
  expect(failedSameOriginRequests, 'failed same-origin request').toEqual([]);
  expect(bodyText, 'error boundary rendered').not.toContain(ERROR_BOUNDARY_TEXT);
}

export function registerRouteTests(pages: readonly SmokePage[]) {
  for (const { path, reason } of pages) {
    test(`${path} works (${reason})`, async ({ page, baseURL }) => {
      await assertPageWorks(page, baseURL, path);
    });
  }
}
