import { randomUUID } from 'node:crypto';

import type { BrowserContext, Page } from '@playwright/test';

import { createApiClient } from '@photoo/api-client';

import { seedConsentCookie } from './fixtures/consent.js';
import { createVerifiedUser } from './fixtures/users.js';
import { signInAsUser } from './support/sign-in.js';
import { expect, test } from './support/test.js';

const LOCALE = 'en';

// tests/smoke/auth.setup.ts's own guard, reused here wherever a spec fills
// and submits a form immediately after page.goto() - docs/steps/1B.12-web-e2e.md
// names "the job-offer form" explicitly as one of the pages that needs it.
const HYDRATION_SETTLE_MS = 500;

function apiBaseUrl(): string {
  const url = process.env.NEXT_PUBLIC_API_URL;
  if (!url) {
    throw new Error(
      'NEXT_PUBLIC_API_URL is not set - this spec creates a photographer profile and signs in ' +
        'over HTTP against the running API and needs it (see apps/web/.env.example, or the ' +
        'e2e CI job env).',
    );
  }
  return url;
}

// Mirrors playwright.config.ts's own default so a `browser`-only test (no
// `baseURL` fixture) can still seed the consent cookie - same convention as
// photographer-onboarding.spec.ts's own `baseUrl()`.
function baseUrl(): string {
  return process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:3000';
}

// Better Auth's bearer() plugin accepts the session token sign-in returns as
// an `Authorization: Bearer` header on a later request - same mechanism
// chat.spec.ts's own signInOverHttp uses to build its fixture.
async function signInOverHttp(email: string, password: string): Promise<string> {
  const api = createApiClient({ baseUrl: apiBaseUrl() });
  const result = await api.POST('/v1/auth/sign-in', { body: { email, password } });
  if (!result.data || !('session' in result.data)) {
    throw new Error(
      `job-board fixture: sign-in for ${email} did not return a session (unexpected 2FA ` +
        `challenge or error): ${JSON.stringify(result.error ?? result.data)}`,
    );
  }
  return result.data.session.token;
}

function authedApi(token: string) {
  return createApiClient({ baseUrl: apiBaseUrl(), headers: { authorization: `Bearer ${token}` } });
}

// Luxembourg City - the same coordinates chat.spec.ts's own fixture request
// uses. Only relevant here as a plausible, valid LatLng: applying doesn't
// route on location, it only requires *a* photographer profile to exist
// (JobApplicationsService#requirePhotographerProfile) - a real API
// precondition this step's own task list doesn't name, so it's built as a
// small HTTP fixture rather than driving the browser through the whole
// onboarding journey 1B.12e already covers.
const PHOTOGRAPHER_LOCATION = { lat: 49.6116, lng: 6.1319 };

async function createPhotographerProfileOverHttp(
  token: string,
  displayName: string,
): Promise<void> {
  const api = authedApi(token);
  const { error } = await api.POST('/v1/me/photographer-profile', {
    body: {
      displayName,
      categories: ['portrait'],
      languages: ['en'],
      location: PHOTOGRAPHER_LOCATION,
      city: 'Luxembourg City',
      countryCode: 'LU',
    },
  });
  if (error) {
    throw new Error(
      `job-board fixture: creating the photographer profile failed: ${JSON.stringify(error)}`,
    );
  }
}

async function signedInPage(
  context: BrowserContext,
  email: string,
  password: string,
): Promise<Page> {
  await seedConsentCookie(context, baseUrl());
  const page = await context.newPage();
  await signInAsUser(page, email, password);
  return page;
}

function jobOfferRow(page: Page, title: string) {
  return page.locator('li').filter({ hasText: title });
}

// One shared page across serial sub-steps: the offer this spec later applies
// to and shortlists against has to exist and be published first, so each
// later test builds on state the earlier ones left behind rather than
// re-deriving it.
test.describe('job board lifecycle', () => {
  test.describe.configure({ mode: 'serial' });

  const tag = randomUUID();
  const companyName = `E2E Job Board Company ${tag}`;
  const jobOfferTitle = `E2E Job Board Offer ${tag}`;
  const photographerDisplayName = `E2E Job Board Photographer ${tag}`;
  const applicationMessage = `E2E job board application, tag ${tag}. Not a real application.`;

  let professionalContext: BrowserContext;
  let professionalPage: Page;

  let signedOutContext: BrowserContext | undefined;
  let photographerContext: BrowserContext | undefined;
  let photographerPage: Page;

  let offerSlug: string;
  let applicationsHref: string;

  test.beforeAll(async ({ browser }) => {
    const professional = await createVerifiedUser('professional');
    professionalContext = await browser.newContext();
    professionalPage = await signedInPage(
      professionalContext,
      professional.email,
      professional.password,
    );
  });

  test.afterAll(async () => {
    await professionalContext.close();
    await signedOutContext?.close();
    await photographerContext?.close();
  });

  test('a fresh professional creates a company profile, posts a remote job offer, and publishes it', async () => {
    await professionalPage.goto(`/${LOCALE}/account/professional-profile`);
    await professionalPage.waitForTimeout(HYDRATION_SETTLE_MS);

    await professionalPage.locator('#professional-company-name').fill(companyName);
    await professionalPage.getByRole('button', { name: 'Create profile' }).click();
    await expect(professionalPage.getByText('Profile created.')).toBeVisible();

    // A remote offer never needs a map point (jobOfferLocationRefinement),
    // which sidesteps #295 (the city picker's own autocomplete only
    // suggests cities with a published photographer): `city`/`countryCode`
    // stay required plain-text fields regardless of `remote`, so a remote
    // offer can be built entirely from typed values with no autocomplete
    // interaction at all.
    await professionalPage.goto(`/${LOCALE}/account/job-offers/new`);
    await professionalPage.waitForTimeout(HYDRATION_SETTLE_MS);

    await professionalPage.locator('#job-offer-title').fill(jobOfferTitle);
    await professionalPage
      .locator('#job-offer-description')
      .fill(`E2E job board fixture offer, tag ${tag}. Not a real job.`);
    await professionalPage.locator('#job-offer-category').selectOption('portrait');
    // The Switch component (ui/switch.tsx) hides the real checkbox with
    // `sr-only`; its visible track/thumb sit on top and intercept a plain
    // pointer click, so this checks it directly rather than clicking through
    // the overlay.
    await professionalPage.getByLabel('This job can be done remotely').check({ force: true });
    await professionalPage.locator('#job-offer-city').fill('Luxembourg City');
    await professionalPage.locator('#job-offer-country').selectOption('LU');

    await professionalPage.getByRole('button', { name: 'Create draft' }).click();
    await expect(professionalPage.getByText('Draft created.')).toBeVisible();

    await professionalPage.goto(`/${LOCALE}/account/job-offers`);
    const row = jobOfferRow(professionalPage, jobOfferTitle);
    await expect(row).toHaveCount(1);
    await expect(row.getByText('Draft', { exact: true })).toBeVisible();

    const applicationsLink = row.getByRole('link', { name: 'Applications' });
    const href = await applicationsLink.getAttribute('href');
    if (!href) {
      throw new Error('job board fixture: the offer row has no "Applications" link href');
    }
    applicationsHref = href;

    await row.getByRole('button', { name: 'Publish' }).click();
    await professionalPage.getByRole('button', { name: 'Yes, publish' }).click();

    await expect(row.getByText('Published', { exact: true })).toBeVisible();
    await expect(row.getByRole('button', { name: 'Publish' })).toHaveCount(0);
  });

  test('a signed-out visitor finds the published offer on the public board by its unique title, never by position, and opens its detail page', async ({
    browser,
    baseURL,
  }) => {
    if (!baseURL) {
      throw new Error('baseURL is not configured (playwright.config.ts)');
    }

    signedOutContext = await browser.newContext();
    await seedConsentCookie(signedOutContext, baseURL);
    const page = await signedOutContext.newPage();

    // The public board also lists the seeded seedProfessionalJobOffer offer
    // and every concurrent run's own offers, so this searches by the tagged
    // title (`q`, ILIKE against JobOffer.title per job-board.repository.ts)
    // instead of reading "the first card" or a result count.
    await page.goto(`/${LOCALE}/job-offers`);
    await page.getByLabel('Keyword').fill(tag);
    await page.getByRole('button', { name: 'Search' }).click();
    await page.waitForURL(/[?&]q=/);

    const card = jobOfferRow(page, jobOfferTitle);
    await expect(card).toHaveCount(1);
    await card.getByRole('link').first().click();

    await page.waitForURL(new RegExp(`/${LOCALE}/job-offers/[^/]+$`));
    const match = new RegExp(`/${LOCALE}/job-offers/([^/?#]+)$`).exec(page.url());
    const slug = match?.[1];
    if (!slug) {
      throw new Error(`job board fixture: could not extract a job offer slug from ${page.url()}`);
    }
    offerSlug = slug;

    await expect(page.getByRole('heading', { name: jobOfferTitle, level: 1 })).toBeVisible();
    // Remote offers render "Remote (city, country)" as one line
    // (job-offers/[slug]/page.tsx's own locationLine), never a blank map or
    // a distance figure.
    await expect(page.getByText('Remote (Luxembourg City, Luxembourg)')).toBeVisible();
    // Signed out: the apply form renders disabled with a sign-in prompt
    // rather than a working form (apply-form.tsx's own `signedOut` branch) -
    // cheap, real confirmation this is genuinely the public, unauthenticated
    // detail page and not an authenticated fallback.
    await expect(page.getByText('Sign in as a photographer to apply.')).toBeVisible();
  });

  test('a fresh photographer applies with a message; a second attempt maps to the specific "already applied" 409', async ({
    browser,
    baseURL,
  }) => {
    if (!baseURL) {
      throw new Error('baseURL is not configured (playwright.config.ts)');
    }

    const photographer = await createVerifiedUser('photographer');
    const token = await signInOverHttp(photographer.email, photographer.password);
    // Built directly over HTTP, the same "fixture over the API, not the
    // browser" philosophy chat.spec.ts's own conversation fixture uses: the
    // flow under test here is the job-board apply/shortlist lifecycle, not
    // photographer-profile creation, which 1B.12e already covers end to end.
    await createPhotographerProfileOverHttp(token, photographerDisplayName);

    photographerContext = await browser.newContext();
    photographerPage = await signedInPage(
      photographerContext,
      photographer.email,
      photographer.password,
    );

    await photographerPage.goto(`/${LOCALE}/job-offers/${offerSlug}`);
    await photographerPage.locator('#job-application-message').fill(applicationMessage);
    await photographerPage.getByRole('button', { name: 'Send application' }).click();
    await expect(
      photographerPage.getByText('Application sent. The company can now see your message.'),
    ).toBeVisible();

    // A genuinely new attempt (a fresh page load, not leftover client
    // state): applying again gets the 409 CONFLICT the API raises on the
    // unique (jobOfferId, photographerId) constraint, and apply-form.tsx
    // maps it to its own dedicated `alreadyApplied` state - not the generic
    // conflict copy request-quote.spec.ts's own double-accept case proves -
    // because 1B.9c built this mapping specifically for this case.
    await photographerPage.reload();
    await photographerPage.locator('#job-application-message').fill(applicationMessage);
    await photographerPage.getByRole('button', { name: 'Send application' }).click();
    await expect(photographerPage.getByText('You already applied to this offer.')).toBeVisible();
    await expect(photographerPage.getByRole('link', { name: 'See my applications' })).toBeVisible();
  });

  test("back in the professional's context, the applications inbox shows the new application, and shortlisting it moves it out of submitted", async () => {
    await professionalPage.goto(applicationsHref);

    const applicationRow = jobOfferRow(professionalPage, applicationMessage);
    await expect(applicationRow).toHaveCount(1);
    await expect(applicationRow.getByText(photographerDisplayName, { exact: true })).toBeVisible();
    await expect(applicationRow.getByText('Submitted', { exact: true })).toBeVisible();

    await applicationRow.getByRole('button', { name: 'Shortlist' }).click();
    await professionalPage.getByRole('button', { name: 'Yes, shortlist' }).click();

    await expect(applicationRow.getByText('Shortlisted', { exact: true })).toBeVisible();
    await expect(applicationRow.getByRole('button', { name: 'Shortlist' })).toHaveCount(0);
    await expect(applicationRow.getByRole('button', { name: 'Reject' })).toHaveCount(0);
  });

  test('in the photographer\'s context, "my applications" shows the shortlisted status, and withdraw is no longer offered', async () => {
    await photographerPage.goto(`/${LOCALE}/account/job-applications`);

    const row = jobOfferRow(photographerPage, jobOfferTitle);
    await expect(row).toHaveCount(1);
    await expect(row.getByText('Shortlisted', { exact: true })).toBeVisible();

    // The state machine is asymmetric: every transition, including
    // `withdrawn`, only succeeds server-side from `submitted`
    // (job-applications.service.ts), so a shortlisted application offers no
    // withdraw control at all - docs/steps/1B.12-web-e2e.md names this as
    // #298, an open product question, not a bug this spec should work
    // around.
    await expect(row.getByRole('button', { name: 'Withdraw' })).toHaveCount(0);
  });
});
