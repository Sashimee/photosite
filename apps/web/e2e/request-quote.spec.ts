import { randomUUID } from 'node:crypto';

import type { BrowserContext, Page } from '@playwright/test';

import { seedConsentCookie } from './fixtures/consent.js';
import { createVerifiedUser, type VerifiedUser } from './fixtures/users.js';
import { signInAsUser } from './support/sign-in.js';
import { expect, test } from './support/test.js';

const LOCALE = 'en';

// packages/db/src/seed.ts: the only seeded photographer that is verified,
// published and has real products - `portrait` + Luxembourg City routes to
// her and nobody else (karim-diallo/lena-weber cover different
// categories/cities), so a fixture request built with that combination is
// unambiguous even with a shared, growing inbox (docs/steps/1B.12-web-e2e.md
// "Decisions for this step").
const SOFIA_EMAIL = 'sofia.martins@photoo.test';

// tests/smoke/pages.ts reads this the same way - a dev-only, Argon2id-hashed
// credential shared by every seed user, never spelled out in test source.
function seedUserPassword(): string {
  const password = process.env.SEED_USER_PASSWORD;
  if (!password) {
    throw new Error(
      'SEED_USER_PASSWORD is not set. This spec signs in as the seeded photographer ' +
        '(packages/db/src/seed.ts getSeedUserPassword()) and needs the same value the ' +
        'seed run used - export it before `pnpm test:e2e` (see packages/db/.env.example).',
    );
  }
  return password;
}

// tests/smoke/auth.setup.ts's own guard, reused here: filling and submitting
// a form fast enough beats React attaching its onSubmit handler.
const HYDRATION_SETTLE_MS = 500;

function futureDateTimeLocal(daysAhead: number): string {
  return new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000).toISOString().slice(0, 16);
}

interface RequestFixture {
  title: string;
  description: string;
}

function buildRequestFixture(tag: string): RequestFixture {
  return {
    title: `E2E portrait request ${tag}`,
    // The photographer dashboard inbox
    // (apps/web/src/app/[locale]/dashboard/requests/page.tsx) never renders
    // RequestSummary.title even though the contract carries it (#319).
    // Description IS rendered there, so it carries the same tag and is what
    // locates the row.
    description: `E2E fixture request, tag ${tag}. Not a real booking.`,
  };
}

async function submitNewRequest(page: Page, fixture: RequestFixture): Promise<string> {
  await page.goto(`/${LOCALE}/requests/new`);
  await page.waitForTimeout(HYDRATION_SETTLE_MS);

  await page.locator('#request-title').fill(fixture.title);
  await page.locator('#request-category').selectOption('portrait');
  await page.locator('#request-description').fill(fixture.description);
  await page.locator('#request-event-date').fill(futureDateTimeLocal(30));

  // CityAutocomplete only fires onCitySelect (and, through it, sets the
  // picked location) once the typed value exactly matches a suggestion
  // after its own debounce - see apps/web/src/app/[locale]/photographers/city-autocomplete.tsx.
  // Waiting on the "Location set." status text (not a sleep) is waiting on
  // that state transition, not on the debounce's own timing.
  await page.locator('input[name="location-city"]').fill('Luxembourg City');
  await expect(page.getByText('Location set.')).toBeVisible();

  await page.locator('#request-address-line1').fill('10 rue de la Gare');
  await page.locator('#request-address-city').fill('Luxembourg City');
  await page.locator('#request-address-postal-code').fill('L-1611');
  await page.locator('#request-address-country').selectOption('LU');

  await page.locator('#request-budget-min').fill('500');
  await page.locator('#request-budget-max').fill('1500');
  await page.locator('#request-usage').selectOption('personal');

  await page.getByRole('button', { name: 'Send request' }).click();
  await page.waitForURL(new RegExp(`/${LOCALE}/requests/[0-9a-f-]{36}$`));

  const match = /\/requests\/([0-9a-f-]{36})$/.exec(page.url());
  const requestId = match?.[1];
  if (!requestId) {
    throw new Error(`submitNewRequest: could not extract a request id from ${page.url()}`);
  }
  return requestId;
}

interface QuoteLineItem {
  label: string;
  qty: number;
  unitPriceEuros: number;
}

// Sends one quote as sofia-martins, scoped to the fixture request by its
// tagged description (never by position - her inbox accumulates rows from
// every previous run of this spec). Returns the created quote's id.
async function photographerSendsQuote(
  photographerPage: Page,
  tag: string,
  lineItem: QuoteLineItem,
): Promise<string> {
  await photographerPage.goto(`/${LOCALE}/dashboard/requests`);

  const row = photographerPage.locator('li').filter({ hasText: tag });
  await expect(row).toHaveCount(1);
  await row.getByRole('button', { name: 'Send a quote' }).click();

  await photographerPage.getByLabel('Item').fill(lineItem.label);
  await photographerPage.getByLabel('Quantity').fill(String(lineItem.qty));
  await photographerPage.getByLabel('Unit price (EUR)').fill(lineItem.unitPriceEuros.toFixed(2));
  await photographerPage.getByRole('button', { name: 'Review quote' }).click();

  const subtotal = lineItem.qty * lineItem.unitPriceEuros;
  await expect(
    photographerPage.getByRole('heading', { name: 'Review before you send' }),
  ).toBeVisible();
  // `exact: true`: the per-line-item row also renders "{qty} × {unit price}",
  // which for a qty of 1 is a superstring of this same total figure.
  await expect(photographerPage.getByText(formatEuros(subtotal), { exact: true })).toBeVisible();

  await photographerPage.getByRole('button', { name: 'Send quote' }).click();
  await photographerPage.waitForURL(new RegExp(`/${LOCALE}/quotes/[0-9a-f-]{36}$`));

  const match = /\/quotes\/([0-9a-f-]{36})$/.exec(photographerPage.url());
  const quoteId = match?.[1];
  if (!quoteId) {
    throw new Error(
      `photographerSendsQuote: could not extract a quote id from ${photographerPage.url()}`,
    );
  }
  return quoteId;
}

function formatEuros(amount: number): string {
  return new Intl.NumberFormat('en', { style: 'currency', currency: 'EUR' }).format(amount);
}

async function signedInPhotographerContext(
  context: BrowserContext,
  baseURL: string,
): Promise<Page> {
  await seedConsentCookie(context, baseURL);
  const page = await context.newPage();
  await signInAsUser(page, SOFIA_EMAIL, seedUserPassword());
  return page;
}

async function signedInClient(
  context: BrowserContext,
  baseURL: string,
  page: Page,
): Promise<VerifiedUser> {
  const client = await createVerifiedUser('client');
  await seedConsentCookie(context, baseURL);
  await signInAsUser(page, client.email, client.password);
  return client;
}

test.describe('request -> quote -> accept', () => {
  test('client accepts a quote: request becomes booked, the quote shows the booking/payment stand-in copy', async ({
    page,
    context,
    browser,
    baseURL,
  }) => {
    if (!baseURL) {
      throw new Error('baseURL is not configured (playwright.config.ts)');
    }

    const tag = randomUUID();
    const fixture = buildRequestFixture(tag);

    await signedInClient(context, baseURL, page);
    const requestId = await submitNewRequest(page, fixture);
    await expect(page.getByRole('heading', { name: fixture.title })).toBeVisible();

    const photographerContext = await browser.newContext();
    try {
      const photographerPage = await signedInPhotographerContext(photographerContext, baseURL);
      const quoteId = await photographerSendsQuote(photographerPage, tag, {
        label: 'Full day portrait session',
        qty: 2,
        unitPriceEuros: 200,
      });

      // The request detail page renders the accept/decline controls itself
      // for any `sent` quote (QuoteCompare, apps/web/src/components/requests/quote-compare.tsx) -
      // accepting happens right here, not on a separate page.
      await page.goto(`/${LOCALE}/requests/${requestId}`);
      await page.getByRole('button', { name: 'Accept quote' }).click();
      await page.getByRole('button', { name: 'Yes, accept quote' }).click();

      // Accepted quotes drop out of QuoteCompare's `sent`-only filter, so the
      // accept control disappears once the request re-renders with the new
      // state, and the request's own status badge flips to "Booked".
      await expect(page.getByText('Booked', { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Accept quote' })).toHaveCount(0);

      // "Booking and payment are coming soon" (apps/web/src/app/[locale]/quotes/[id]/page.tsx's
      // acceptedNotice) only renders on the quote's own page, not here - follow
      // the same link the request page still offers to it.
      await page.getByRole('link', { name: new RegExp(formatEuros(400)) }).click();
      await page.waitForURL(`**/${LOCALE}/quotes/${quoteId}`);

      // Client's own total contract (docs/steps/1B.12-web-e2e.md "Money is
      // integer cents"): quoteTotals sets totalCents = subtotalCents, the
      // platform fee is deducted from the photographer's payout, never added
      // on top of what the client sees - so the client's total is exactly
      // qty * unitPrice, no fee line at all (payout/fee are photographer-only,
      // apps/web/src/app/[locale]/quotes/[id]/page.tsx's `isOwnPhotographerQuote` gate).
      await expect(page.getByRole('heading', { name: formatEuros(400) })).toBeVisible();
      await expect(page.getByText('Platform fee')).not.toBeVisible();
      await expect(
        page.getByText(
          "Quote accepted. Booking and payment are coming soon — we'll be in touch with next steps.",
        ),
      ).toBeVisible();
    } finally {
      await photographerContext.close();
    }
  });

  test('client declines a quote: the quote is no longer actionable and shows as declined', async ({
    page,
    context,
    browser,
    baseURL,
  }) => {
    if (!baseURL) {
      throw new Error('baseURL is not configured (playwright.config.ts)');
    }

    const tag = randomUUID();
    const fixture = buildRequestFixture(tag);

    await signedInClient(context, baseURL, page);
    const requestId = await submitNewRequest(page, fixture);

    const photographerContext = await browser.newContext();
    try {
      const photographerPage = await signedInPhotographerContext(photographerContext, baseURL);
      const quoteId = await photographerSendsQuote(photographerPage, tag, {
        label: 'Portrait session',
        qty: 1,
        unitPriceEuros: 300,
      });

      await page.goto(`/${LOCALE}/requests/${requestId}`);
      await page.getByRole('button', { name: 'Decline quote' }).click();
      await page.getByRole('button', { name: 'Yes, decline quote' }).click();

      // Declined quotes drop out of QuoteCompare's `sent`-only filter the
      // same way an accepted one does. Declining doesn't touch the Request
      // row at all (apps/api's quotes.service.ts#decline), so the request
      // stays `quoted` - not reverted to anything decline-specific - and
      // stays open to another photographer's quote.
      await expect(page.getByRole('button', { name: 'Decline quote' })).toHaveCount(0);
      await expect(page.getByText('Quoted', { exact: true })).toBeVisible();

      await page.goto(`/${LOCALE}/quotes/${quoteId}`);
      await expect(page.getByText('Quote declined.')).toBeVisible();
      // A quote can only transition from `sent` (apps/api's quotes.service.ts);
      // once declined, neither action is offered any more.
      await expect(page.getByRole('button', { name: 'Accept quote' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Decline quote' })).toHaveCount(0);
      await expect(page.getByText('Declined', { exact: true })).toBeVisible();
    } finally {
      await photographerContext.close();
    }
  });

  // 1B.5's own decisions document the exact 409 mapping this proves. The web
  // app maps every CONFLICT for this namespace through requestErrorMessage's
  // generic code->message table (apps/web/src/lib/request-errors.ts), not by
  // parsing the API's message text, onto `web.quotes.errors.conflict` -
  // which for this namespace happens to already read "This quote is no
  // longer available." The mapping is generic, not specific to double-accept.
  test('accepting the same quote twice maps the second attempt to the 409 conflict message', async ({
    page,
    context,
    browser,
    baseURL,
  }) => {
    if (!baseURL) {
      throw new Error('baseURL is not configured (playwright.config.ts)');
    }

    const tag = randomUUID();
    const fixture = buildRequestFixture(tag);

    await signedInClient(context, baseURL, page);
    await submitNewRequest(page, fixture);

    const photographerContext = await browser.newContext();
    try {
      const photographerPage = await signedInPhotographerContext(photographerContext, baseURL);
      const quoteId = await photographerSendsQuote(photographerPage, tag, {
        label: 'Portrait session',
        qty: 1,
        unitPriceEuros: 250,
      });

      // Two tabs in the client's own context, both loaded while the quote is
      // still `sent`, so both still offer the Accept button - the same
      // shape as a genuine double-accept race, without needing an actual
      // race condition to reproduce it.
      const secondPage = await context.newPage();
      try {
        await page.goto(`/${LOCALE}/quotes/${quoteId}`);
        await secondPage.goto(`/${LOCALE}/quotes/${quoteId}`);

        await page.getByRole('button', { name: 'Accept quote' }).click();
        await page.getByRole('button', { name: 'Yes, accept quote' }).click();
        await expect(
          page.getByText(
            "Quote accepted. Booking and payment are coming soon — we'll be in touch with next steps.",
          ),
        ).toBeVisible();

        await secondPage.getByRole('button', { name: 'Accept quote' }).click();
        await secondPage.getByRole('button', { name: 'Yes, accept quote' }).click();
        await expect(secondPage.getByText('This quote is no longer available.')).toBeVisible();
        // The failed attempt never got to close its own confirm dialog.
        await expect(secondPage.getByRole('button', { name: 'Yes, accept quote' })).toBeVisible();
      } finally {
        await secondPage.close();
      }
    } finally {
      await photographerContext.close();
    }
  });
});
