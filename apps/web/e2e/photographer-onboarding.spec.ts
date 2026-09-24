import { randomUUID } from 'node:crypto';

import type { BrowserContext, Locator, Page } from '@playwright/test';

import { createApiClient } from '@photoo/api-client';

import { seedConsentCookie } from './fixtures/consent.js';
import { createVerifiedUser, type VerifiedUser } from './fixtures/users.js';
import { signInAsUser } from './support/sign-in.js';
import { expect, test } from './support/test.js';

const LOCALE = 'en';

// tests/smoke/auth.setup.ts's own guard, reused here: filling and submitting
// a form fast enough beats React attaching its onSubmit handler.
const HYDRATION_SETTLE_MS = 500;

// apps/web/src/lib/presigned-upload.ts's own SCAN_POLL_TIMEOUT_MS gives a
// real ClamAV scan up to 60s; matching that here (instead of Playwright's
// default assertion timeout) means the named errors below surface on a real
// timeout, rather than a bare "Test timeout exceeded".
const SCAN_SETTLE_TIMEOUT_MS = 65_000;

function apiBaseUrl(): string {
  const url = process.env.NEXT_PUBLIC_API_URL;
  if (!url) {
    throw new Error(
      'NEXT_PUBLIC_API_URL is not set - this spec fetches LU verification requirements and ' +
        'signs in over HTTP against the running API (see apps/web/.env.example, or the e2e CI job env).',
    );
  }
  return url;
}

// Mirrors playwright.config.ts's own default so `test.beforeAll` (which has
// no `page`/`context` fixture, only worker-scoped ones) can seed the consent
// cookie without depending on a test-scoped `baseURL` fixture.
function baseUrl(): string {
  return process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:3000';
}

const MINIMAL_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function pngFile(name: string): { name: string; mimeType: string; buffer: Buffer } {
  return { name, mimeType: 'image/png', buffer: Buffer.from(MINIMAL_PNG_BASE64, 'base64') };
}

interface RequiredDocumentFixture {
  key: string;
  label: string;
}

// docs/steps/1B.8-photographer-dashboard.md: "the required documents come
// from GET /v1/countries/{code}/verification-requirements, never a
// hardcoded list" - this spec proves the UI honours that by fetching the
// same, real response itself and driving every later assertion off it,
// rather than typing out LUXEMBOURG_REQUIRED_DOCUMENTS (packages/db/src/seed.ts)
// by hand and hoping it stays in sync.
async function fetchLuxembourgRequirements(): Promise<RequiredDocumentFixture[]> {
  const api = createApiClient({ baseUrl: apiBaseUrl() });
  const { data, error } = await api.GET('/v1/countries/{code}/verification-requirements', {
    params: { path: { code: 'LU' } },
  });
  if (!data) {
    throw new Error(
      `onboarding fixture: could not load LU's verification requirements: ${JSON.stringify(error)}`,
    );
  }
  if (data.documents.length === 0) {
    throw new Error('onboarding fixture: LU has no required verification documents configured');
  }
  return data.documents.map((document) => ({
    key: document.key,
    label: document.label.en ?? document.key,
  }));
}

function verificationSlot(page: Page, label: string): Locator {
  return page.getByRole('listitem').filter({ has: page.getByText(label, { exact: true }) });
}

// Polls the DOM (via Playwright's own auto-retrying `expect`, never a bare
// sleep) for the pending-upload row to disappear - the point at which
// apps/web/src/lib/portfolio-upload.ts has cleared the virus scan and
// attached the image. Rethrows as a named error on timeout, the same
// discipline chat.spec.ts's waitForUploadClean uses for its own (API-side)
// poll, so a real failure here reads as "the scan/attach didn't finish", not
// a bare Playwright timeout.
async function waitForPendingPortfolioUploadToSettle(
  page: Page,
  fileName: string,
  timeoutMs = SCAN_SETTLE_TIMEOUT_MS,
): Promise<void> {
  const pendingRow = page.locator('li').filter({ hasText: fileName });
  try {
    await expect(pendingRow).toHaveCount(0, { timeout: timeoutMs });
  } catch {
    const stillPending = await pendingRow.count();
    throw new Error(
      `portfolio upload fixture: "${fileName}" did not finish scanning and attaching within ` +
        `${String(timeoutMs)}ms (${String(stillPending)} pending row(s) still on screen)`,
    );
  }
}

// Same discipline as above, for one verification document slot: polls its
// own `role="status"` text (apps/web/src/app/[locale]/dashboard/verification/verification-document-slot.tsx)
// for "Uploaded" (documentStatus.clean), and names which document and what
// its status actually was on a real timeout.
async function waitForVerificationDocumentClean(
  slot: Locator,
  label: string,
  timeoutMs = SCAN_SETTLE_TIMEOUT_MS,
): Promise<void> {
  const status = slot.getByRole('status');
  try {
    await expect(status).toHaveText('Uploaded', { timeout: timeoutMs });
  } catch {
    const current = await status.textContent();
    throw new Error(
      `verification document fixture: "${label}" did not clear its virus scan within ` +
        `${String(timeoutMs)}ms (status shows "${String(current)}")`,
    );
  }
}

async function signedInPhotographerPage(
  browser: import('@playwright/test').Browser,
): Promise<{ context: BrowserContext; page: Page; user: VerifiedUser }> {
  const user = await createVerifiedUser('photographer');
  const context = await browser.newContext();
  await seedConsentCookie(context, baseUrl());
  const page = await context.newPage();
  await signInAsUser(page, user.email, user.password);
  return { context, page, user };
}

// A single fresh photographer's own onboarding journey, from an empty
// checklist through verification submit. Split into named sub-steps for
// readable reporting, but run serially against one shared page: the
// checklist/portfolio/verification states this spec asserts genuinely build
// on each other (a profile has to exist before portfolio or verification are
// reachable at all), so re-deriving that state per test would mean either
// repeating the whole setup (an extra sign-up, profile, portfolio upload and
// verification case per assertion) or reaching for `sofia-martins` /
// `noor-hassan`, both explicitly ruled out for this exact journey by
// docs/steps/1B.12-web-e2e.md's own "Decisions for this step".
test.describe('photographer onboarding', () => {
  test.describe.configure({ mode: 'serial' });

  const tag = randomUUID();
  const displayName = `E2E Onboarding Photographer ${tag}`;
  const productTitle = `E2E Package ${tag}`;
  const tierPriceEuros = '149.99';

  const PORTFOLIO_TEST_TITLE =
    'uploading a portfolio image shows the scanning-to-settled transition, and a product tier round-trips its cents';
  const VERIFICATION_TEST_TITLE =
    'verification requirements come from the API; uploading real documents unblocks submit, and the case becomes read-only';

  let context: BrowserContext;
  let page: Page;
  let requirements: RequiredDocumentFixture[];

  test.beforeAll(async ({ browser }) => {
    requirements = await fetchLuxembourgRequirements();
    ({ context, page } = await signedInPhotographerPage(browser));
  });

  test.afterAll(async () => {
    await context.close();
  });

  test('a fresh photographer sees the checklist with nothing done, and the Stripe row rendered as unavailable rather than omitted', async () => {
    await page.goto(`/${LOCALE}/dashboard`);

    await expect(page.getByText('Create your profile below to get started.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Create your profile' })).toHaveAttribute(
      'href',
      `/${LOCALE}/dashboard/profile`,
    );

    // 1B.8's own regression to guard against: the payouts/Stripe row must
    // still render, just as "not available yet" - never disappear because
    // 1A.8/Stripe onboarding hasn't shipped.
    await expect(page.getByText('Payouts')).toBeVisible();
    await expect(page.getByText('Not available yet.')).toBeVisible();

    // Without a profile, portfolio/verification offer no link to manage
    // them yet - a further, cheap proof that "nothing is done".
    await expect(page.getByRole('link', { name: 'Manage portfolio' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Manage verification' })).toHaveCount(0);
  });

  test('an invalid submission is blocked inline, before a happy-path profile create ever reaches the network', async () => {
    await page.goto(`/${LOCALE}/dashboard/profile`);
    await page.waitForTimeout(HYDRATION_SETTLE_MS);

    const profileCreateRequests: string[] = [];
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().endsWith('/v1/me/photographer-profile')) {
        profileCreateRequests.push(request.url());
      }
    });

    await page.getByRole('checkbox', { name: 'Portrait' }).check();
    await page.getByRole('checkbox', { name: 'English' }).check();
    await page.locator('input[name="location-city"]').fill('Luxembourg City');
    await expect(page.getByText('Location set.')).toBeVisible();

    // displayName is deliberately left blank - profile-form.tsx derives the
    // profile's slug from it (slugify()), so an invalid display name is the
    // reachable equivalent of an invalid slug: there is no separate,
    // user-editable slug field, the API assigns and de-duplicates it itself
    // (apps/api/src/modules/profiles/slug.ts generateUniqueSlug).
    await page.getByRole('button', { name: 'Create profile' }).click();
    await expect(page.locator('#profile-display-name-error')).toHaveText(
      'This value is too short.',
    );
    expect(
      profileCreateRequests,
      'an invalid submission must be blocked by client-side validation, never reach the network',
    ).toEqual([]);

    await page.locator('#profile-display-name').fill(displayName);
    await page.getByRole('button', { name: 'Create profile' }).click();

    await expect(page.getByText('Profile created.')).toBeVisible();
    expect(profileCreateRequests).toHaveLength(1);
  });

  // Playwright statically parses this signature to find fixture
  // dependencies (there are none besides `testInfo`), so it must be a
  // literal `{}`.
  // eslint-disable-next-line no-empty-pattern
  test(PORTFOLIO_TEST_TITLE, async ({}, testInfo) => {
    // Real ClamAV (#327) against a 1x1 fixture on localhost can clear the
    // scan in well under a render frame, so asserting the transient
    // "Scanning for viruses…" text itself would assert on a frame that
    // isn't guaranteed to ever paint - waitForPendingPortfolioUploadToSettle
    // below polls from "still pending" to "attached", which is the real,
    // reliably observable half of the transition. Matches chat.spec.ts's
    // own testInfo.setTimeout(90_000) for the same real-scan budget.
    testInfo.setTimeout(90_000);

    await page.goto(`/${LOCALE}/dashboard/portfolio`);

    const fileName = `portfolio-${tag}.png`;
    await page.locator('input[type="file"]').setInputFiles(pngFile(fileName));

    await waitForPendingPortfolioUploadToSettle(page, fileName);

    // The attached image's moderation status is either "Processing" or
    // "Pending review" depending on whether apps/worker's image-process job
    // (sharp) won the race against the virus scan before attach
    // (apps/api/src/modules/profiles/portfolio.service.ts's own
    // `alreadyProcessed` check) - both are legitimate, not-yet-approved
    // outcomes, so this asserts either rather than picking one and flaking
    // on the other.
    await expect(page.getByText(/^(Processing|Pending review)$/, { exact: true })).toBeVisible();
    await expect(page.getByText("You haven't uploaded any photos yet.")).toHaveCount(0);

    await page.goto(`/${LOCALE}/dashboard/products/new`);
    await page.waitForTimeout(HYDRATION_SETTLE_MS);

    await page.locator('#product-title-en').fill(productTitle);
    await page.locator('#product-category').selectOption('portrait');
    await page.locator('#product-duration').fill('90');
    await page.locator('#product-base-price').fill('120');
    await page.getByLabel('Usage').selectOption('personal');
    await page.getByLabel('Price', { exact: true }).fill(tierPriceEuros);
    await page.getByLabel("What's included").fill('One edited online gallery, digital delivery.');

    await page.getByRole('button', { name: 'Add package' }).click();
    await expect(page.getByText('Package added.')).toBeVisible();

    // The round trip: re-render from the API's own persisted response, not
    // the value this test just typed in - the list page's "from" price and
    // the edit page's price field both come from a fresh GET, not client
    // memory.
    await page.goto(`/${LOCALE}/dashboard/products`);
    const productRow = page.locator('li').filter({ hasText: productTitle });
    await expect(productRow.getByText(`From €${tierPriceEuros}`)).toBeVisible();

    await productRow.getByRole('link', { name: 'Edit' }).click();
    await expect(page.getByLabel('Price', { exact: true })).toHaveValue(tierPriceEuros);
    await expect(page.locator('#product-base-price')).toHaveValue('120');
  });

  // eslint-disable-next-line no-empty-pattern
  test(VERIFICATION_TEST_TITLE, async ({}, testInfo) => {
    // Up to 4 sequential real scans (waitForVerificationDocumentClean's own
    // budget is 65s each in the worst case) - generous headroom over
    // Playwright's 30s default, matching chat.spec.ts's own real-scan
    // testInfo.setTimeout precedent.
    testInfo.setTimeout(5 * 60_000);

    await page.goto(`/${LOCALE}/dashboard/verification`);

    // verification-manager.tsx renders no per-document slots (or labels)
    // until a case exists, only this notice.
    await expect(
      page.getByText('Start verification above to upload your documents.'),
    ).toBeVisible();

    await page.locator('#verification-business-name').fill(`E2E Verification Business ${tag}`);
    await page.getByRole('button', { name: 'Start verification' }).click();
    await expect(
      page.getByText('Verification started. Upload your documents below.'),
    ).toBeVisible();

    // Every requirement this spec fetched live from the API a moment ago
    // must be represented on screen, by the same label the API returned -
    // the concrete proof that this page is driven by that response, not a
    // hardcoded document list.
    for (const requirement of requirements) {
      await expect(page.getByText(requirement.label, { exact: true })).toBeVisible();
    }

    if (requirements.length < 2) {
      throw new Error(
        `verification fixture: expected LU to require at least 2 documents, got ${String(requirements.length)}`,
      );
    }

    // Every required document is uploaded and its own pending-to-clean
    // transition proven (real ClamAV against a tiny fixture can clear well
    // inside a render frame, so this proves "pending -> clean", the
    // reliably observable half, rather than a transient mid-scan frame
    // that isn't guaranteed to ever paint - see the portfolio test's own
    // comment). This both exercises the multi-document upload mechanic and
    // reaches the only state the API actually allows submitting from: every
    // required document clean (verification.service.ts#submit).
    for (const requirement of requirements) {
      const slot = verificationSlot(page, requirement.label);
      await slot
        .locator('input[type="file"]')
        .setInputFiles(pngFile(`${requirement.key}-${tag}.png`));
      await waitForVerificationDocumentClean(slot, requirement.label);
    }

    await page.getByRole('button', { name: 'Submit for review' }).click();
    await page.getByRole('button', { name: 'Yes, submit' }).click();

    await expect(page.getByText('Submitted, waiting for review', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Upload' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Replace' })).toHaveCount(0);

    // 1B.8c's no-edit-after-submit rule, proven against a real navigation
    // and reload, not just leftover client state: a submitted case offers no
    // upload control even after leaving and coming back.
    await page.goto(`/${LOCALE}/dashboard`);
    await page.goto(`/${LOCALE}/dashboard/verification`);
    await expect(page.getByRole('button', { name: 'Upload' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Replace' })).toHaveCount(0);
    await expect(page.getByText('Submitted, waiting for review', { exact: true })).toBeVisible();
  });

  test('the checklist reports verification as submitted without implying the profile is published', async () => {
    await page.goto(`/${LOCALE}/dashboard`);

    // 1B.8a's decision: the UI reports state, it never implies an action
    // publishes a profile when it does not - a submitted-but-not-yet-decided
    // verification case is exactly the state that regression would show
    // wrong.
    await expect(page.getByText("Your profile isn't published yet")).toBeVisible();
    await expect(
      page.getByText(
        'Publishing depends on verification and the other requirements below — nothing on this page publishes it directly.',
      ),
    ).toBeVisible();
    await expect(page.getByText('Submitted, waiting for review.', { exact: true })).toBeVisible();
  });
});
