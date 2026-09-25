import { randomUUID } from 'node:crypto';

import type { BrowserContext, Page, Response } from '@playwright/test';

import { createApiClient } from '@photoo/api-client';

import { seedConsentCookie } from './fixtures/consent.js';
import { createVerifiedUser, type VerifiedUser } from './fixtures/users.js';
import { clearAuthRateLimits } from './support/rate-limit.js';
import { signInAsUser } from './support/sign-in.js';
import { expect, test } from './support/test.js';

const LOCALE = 'en';

// packages/db/src/seed.ts: the only seeded photographer that is verified,
// published and has a real profile - required to send a quote at all
// (QuotesService#requirePhotographerProfile rejects an unpublished one), and
// shares the same seed credential every seed user does.
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

function apiBaseUrl(): string {
  const url = process.env.NEXT_PUBLIC_API_URL;
  if (!url) {
    throw new Error(
      'NEXT_PUBLIC_API_URL is not set - this spec builds its fixture conversation over HTTP ' +
        'against the running API and needs it (see apps/web/.env.example, or the e2e CI job env).',
    );
  }
  return url;
}

// Better Auth's bearer() plugin (apps/api/src/modules/auth/auth-instance.ts)
// accepts the session token sign-in returns as an `Authorization: Bearer`
// header on any later request - the same mechanism apps/api's own
// integration tests use via fastify().inject, ported to a real HTTP call
// since this spec has no inject() to call.
async function signInOverHttp(email: string, password: string): Promise<string> {
  const api = createApiClient({ baseUrl: apiBaseUrl() });
  const result = await api.POST('/v1/auth/sign-in', { body: { email, password } });
  if (!result.data || !('session' in result.data)) {
    throw new Error(
      `chat fixture: sign-in for ${email} did not return a session (unexpected 2FA challenge ` +
        `or error): ${JSON.stringify(result.error ?? result.data)}`,
    );
  }
  return result.data.session.token;
}

function authedApi(token: string) {
  return createApiClient({ baseUrl: apiBaseUrl(), headers: { authorization: `Bearer ${token}` } });
}

function futureIsoDateTime(daysAhead: number): string {
  return new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000).toISOString();
}

// Sofia Martins's own seeded coordinates (packages/db/src/seed.ts) - routing
// is irrelevant here since the quote below is addressed to her directly by
// requestId, but reusing her real city keeps the fixture request plausible.
const FIXTURE_REQUEST_LOCATION = { lat: 49.6116, lng: 6.1319 };

interface FixtureConversation {
  conversationId: string;
  quoteId: string;
  client: VerifiedUser;
  clientToken: string;
  photographerToken: string;
}

// Builds the quote conversation directly over HTTP - a fresh client plus
// sofia-martins, a request/quote/conversation in the same shape
// packages/db/src/seed.ts's seedQuoteConversation creates by hand, tagged
// with a unique subject - rather than driving the browser through the whole
// request -> quote flow. The flow under test in this file is the socket
// layer, not how the conversation came to exist, and 1B.12c
// (request-quote.spec.ts) already covers that browser path.
async function buildFixtureConversation(tag: string): Promise<FixtureConversation> {
  const client = await createVerifiedUser('client');
  const clientToken = await signInOverHttp(client.email, client.password);
  const photographerToken = await signInOverHttp(SOFIA_EMAIL, seedUserPassword());

  const clientApi = authedApi(clientToken);
  const photographerApi = authedApi(photographerToken);

  const requestResult = await clientApi.POST('/v1/requests', {
    body: {
      title: `E2E chat fixture ${tag}`,
      category: 'portrait',
      description: `E2E chat fixture request, tag ${tag}. Not a real booking.`,
      eventDate: futureIsoDateTime(30),
      dateFlexible: false,
      location: FIXTURE_REQUEST_LOCATION,
      address: {
        line1: '10 rue de la Gare',
        city: 'Luxembourg City',
        postalCode: 'L-1611',
        countryCode: 'LU',
      },
      budgetMin: { amountCents: 20000, currency: 'EUR' },
      budgetMax: { amountCents: 40000, currency: 'EUR' },
      usage: 'personal',
    },
  });
  if (!requestResult.data) {
    throw new Error(
      `chat fixture: creating the request failed: ${JSON.stringify(requestResult.error)}`,
    );
  }

  // QuotesService#createForRequest creates the (type: 'quote', subjectId:
  // quote.id) conversation inside the same transaction as the quote
  // (apps/api/src/modules/quotes/quotes.service.ts) - no separate
  // conversation-creation call is needed or offered.
  const quoteResult = await photographerApi.POST('/v1/quotes', {
    body: {
      requestId: requestResult.data.id,
      lineItems: [{ label: `Portrait session, tag ${tag}`, qty: 1, unitCents: 15000 }],
      validUntil: futureIsoDateTime(7),
    },
  });
  if (!quoteResult.data) {
    throw new Error(
      `chat fixture: creating the quote failed: ${JSON.stringify(quoteResult.error)}`,
    );
  }

  // A fresh client (createVerifiedUser) has never had any other
  // conversation, so it is the only item in their own list - unlike
  // sofia-martins's own shared, growing inbox, which this spec never lists
  // or asserts a count against.
  const conversationsResult = await clientApi.GET('/v1/conversations', {
    params: { query: { limit: 1 } },
  });
  const conversation = conversationsResult.data?.items[0];
  if (
    !conversation ||
    conversation.subjectRef?.type !== 'quote' ||
    conversation.subjectRef.quoteId !== quoteResult.data.id
  ) {
    throw new Error(
      `chat fixture: expected the fresh client's only conversation to be the one just ` +
        `created for quote ${quoteResult.data.id}, got ${JSON.stringify(conversationsResult.data)}`,
    );
  }

  return {
    conversationId: conversation.id,
    quoteId: quoteResult.data.id,
    client,
    clientToken,
    photographerToken,
  };
}

async function signedInPage(
  context: BrowserContext,
  baseURL: string,
  email: string,
  password: string,
): Promise<Page> {
  await seedConsentCookie(context, baseURL);
  const page = await context.newPage();
  await signInAsUser(page, email, password);
  return page;
}

// `framenavigated` fires for same-document History API calls as well as
// real reloads. It fires here intermittently with no code of ours anywhere
// near it: Next's own App Router (client/components/app-router.js's
// `HistoryUpdater`) calls `history.replaceState()` to the *unchanged*
// canonical URL as routine bookkeeping whenever its internal router state
// changes for any reason, including a background Link prefetch settling
// (`pingVisibleLinks`, for the header's own "Messages" link and this page's
// "back to messages" link) - confirmed with a raw CDP session, reporting
// `navigationType: "historyApi"` and no accompanying navigation-type
// request. A real reload always makes one (a fresh document GET); tracking
// that instead is what actually proves "no reload happened".
function trackNavigations(page: Page): string[] {
  const navigations: string[] = [];
  page.on('request', (request) => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
      navigations.push(request.url());
    }
  });
  return navigations;
}

async function unreadCount(token: string): Promise<number> {
  const result = await authedApi(token).GET('/v1/conversations/unread-count');
  if (!result.data) {
    throw new Error(
      `chat fixture: could not read the unread count: ${JSON.stringify(result.error)}`,
    );
  }
  return result.data.count;
}

// apps/web/src/lib/use-conversation.ts marks a conversation read 500ms after
// it becomes both visible and focused, which would otherwise race the badge
// assertion below on a loaded machine. A background tab's
// `document.hasFocus()` is false in real Chromium, so bringing a second,
// idle tab in the *same* photographer context to the front keeps the thread
// tab unfocused and its conversation un-auto-read for the rest of this test.
async function openBackgroundedThread(
  context: BrowserContext,
  baseURL: string,
  conversationId: string,
): Promise<Page> {
  const threadPage = await signedInPage(context, baseURL, SOFIA_EMAIL, seedUserPassword());
  await threadPage.goto(`/${LOCALE}/messages/${conversationId}`);

  const idlePage = await context.newPage();
  await idlePage.goto(`/${LOCALE}/account`);
  await idlePage.bringToFront();

  return threadPage;
}

const MINIMAL_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

async function waitForUploadClean(
  token: string,
  uploadId: string,
  timeoutMs = 60_000,
): Promise<void> {
  const api = authedApi(token);
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const { data, error } = await api.GET('/v1/uploads/{id}', {
      params: { path: { id: uploadId } },
    });
    if (!data) {
      throw new Error(
        `chat attachment fixture: could not check upload ${uploadId}'s scan status: ${JSON.stringify(error)}`,
      );
    }
    if (data.status === 'clean' || data.status === 'processed') {
      return;
    }
    if (data.status === 'infected' || data.status === 'failed') {
      throw new Error(
        `chat attachment fixture: upload ${uploadId}'s virus scan ended in status "${data.status}"`,
      );
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `chat attachment fixture: upload ${uploadId} did not clear its virus scan within ` +
          `${String(timeoutMs)}ms (last status: "${data.status}")`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

function isUploadCreateResponse(response: Response): boolean {
  return response.url().endsWith('/v1/uploads') && response.request().method() === 'POST';
}

test.describe('chat', () => {
  // Each test here signs in four times (two over HTTP to build the fixture,
  // two more in real browser contexts) against apps/api's 5/minute sign-in
  // limit - more than the harness's own per-test reset
  // (support/test.ts's autouse fixture) was sized for, and enough for two
  // of these tests running in the e2e project's own parallel workers to
  // trip it. Serial mode plus the extra mid-test reset below keep this
  // spec's own sign-in bursts small and fresh instead.
  test.describe.configure({ mode: 'serial' });

  // 1B.6's own component tests already cover the socket-unavailable REST
  // fallback against a mocked socket - this spec's only job is proving the
  // real connection works, so it never disconnects or blocks the socket.
  test("a message sent by one participant arrives in the other's thread via a socket push, not a reload, and updates the recipient's unread badge", async ({
    browser,
    baseURL,
  }) => {
    if (!baseURL) {
      throw new Error('baseURL is not configured (playwright.config.ts)');
    }

    const tag = randomUUID();
    const fixture = await buildFixtureConversation(tag);
    await clearAuthRateLimits();
    const messageBody = `E2E chat push ${tag}`;

    const clientContext = await browser.newContext();
    const photographerContext = await browser.newContext();
    try {
      const threadPage = await openBackgroundedThread(
        photographerContext,
        baseURL,
        fixture.conversationId,
      );
      const navigationsOnThreadPage = trackNavigations(threadPage);

      const clientPage = await signedInPage(
        clientContext,
        baseURL,
        fixture.client.email,
        fixture.client.password,
      );
      await clientPage.goto(`/${LOCALE}/messages/${fixture.conversationId}`);

      const before = await unreadCount(fixture.photographerToken);

      await clientPage.locator('#message-composer-body').fill(messageBody);
      await clientPage.getByRole('button', { name: 'Send' }).click();

      // Proof 1: the message body renders in the recipient's thread with no
      // navigation of their page in between - a genuine socket push, not a
      // refetch triggered by this test.
      await expect(threadPage.getByText(messageBody)).toBeVisible();

      // Proof 2: the header's unread badge (apps/web/src/components/messages/unread-badge.tsx)
      // also updates live, from the same CONVERSATION_UPDATED broadcast
      // (apps/api/src/modules/chat/chat.service.ts#sendMessage) - checked by
      // its `aria-label` (the exact count) rather than its capped "9+"
      // display text, so this holds regardless of how much unread history
      // sofia-martins has accumulated from earlier runs.
      const badge = threadPage.locator(`a[href="/${LOCALE}/messages"] span[aria-label]`);
      await expect(badge).toHaveAttribute('aria-label', String(before + 1));

      expect(
        navigationsOnThreadPage,
        'the recipient thread page navigated - this would prove a reload, not a push',
      ).toEqual([]);
      expect(threadPage.url()).toContain(`/${LOCALE}/messages/${fixture.conversationId}`);
    } finally {
      await clientContext.close();
      await photographerContext.close();
    }
  });

  test('an attachment sent by one participant renders in both threads', async ({
    browser,
    baseURL,
  }, testInfo) => {
    if (!baseURL) {
      throw new Error('baseURL is not configured (playwright.config.ts)');
    }
    // apps/web/src/lib/presigned-upload.ts's own SCAN_POLL_TIMEOUT_MS gives a
    // real scan up to 60s; matching that here (instead of Playwright's 30s
    // default) means waitForUploadClean's own named, diagnosable error
    // surfaces on a real timeout, rather than a bare "Test timeout exceeded".
    testInfo.setTimeout(90_000);

    const tag = randomUUID();
    const fixture = await buildFixtureConversation(tag);
    await clearAuthRateLimits();

    const clientContext = await browser.newContext();
    const photographerContext = await browser.newContext();
    try {
      const photographerPage = await signedInPage(
        photographerContext,
        baseURL,
        SOFIA_EMAIL,
        seedUserPassword(),
      );
      await photographerPage.goto(`/${LOCALE}/messages/${fixture.conversationId}`);
      const navigationsOnPhotographerPage = trackNavigations(photographerPage);

      const clientPage = await signedInPage(
        clientContext,
        baseURL,
        fixture.client.email,
        fixture.client.password,
      );
      await clientPage.goto(`/${LOCALE}/messages/${fixture.conversationId}`);

      const uploadResponsePromise = clientPage.waitForResponse(isUploadCreateResponse);
      await clientPage.locator('input[type="file"]').setInputFiles({
        name: `chat-attachment-${tag}.png`,
        mimeType: 'image/png',
        buffer: Buffer.from(MINIMAL_PNG_BASE64, 'base64'),
      });
      const uploadResponse = await uploadResponsePromise;
      const uploadBody = (await uploadResponse.json()) as { uploadId: string };

      // apps/web/src/lib/chat-attachments.ts marks a picked file "done" as
      // soon as the presigned PUT + complete call resolves - it does *not*
      // itself wait out the virus scan (unlike
      // apps/web/src/lib/presigned-upload.ts's uploadAndScanFile), so the
      // composer's Send button can be enabled before the attachment is
      // actually attachable; sending too early gets a 422 (ChatService's
      // own isUploadReady check). Polling the same upload directly here
      // means Send is only clicked once ClamAV has actually cleared it.
      await waitForUploadClean(fixture.clientToken, uploadBody.uploadId);

      await expect(
        clientPage.getByText('Wait for attachments to finish uploading before sending.'),
      ).toHaveCount(0);
      await clientPage.getByRole('button', { name: 'Send' }).click();

      await expect(photographerPage.getByRole('button', { name: 'View attachment' })).toBeVisible();
      await expect(clientPage.getByRole('button', { name: 'View attachment' })).toBeVisible();

      expect(
        navigationsOnPhotographerPage,
        'the recipient thread page navigated - this would prove a reload, not a push',
      ).toEqual([]);
    } finally {
      await clientContext.close();
      await photographerContext.close();
    }
  });
});
