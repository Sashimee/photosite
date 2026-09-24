import type { BrowserContext } from '@playwright/test';

import { createApiClient } from '@photoo/api-client';

import {
  buildDecision,
  CONSENT_COOKIE_MAX_AGE_SECONDS,
  CONSENT_COOKIE_NAME,
  encodeConsentCookieValue,
} from '../../src/lib/consent.js';

function apiBaseUrl(): string {
  const url = process.env.NEXT_PUBLIC_API_URL;
  if (!url) {
    throw new Error(
      'NEXT_PUBLIC_API_URL is not set - seedConsentCookie reads GET /v1/policy-version and ' +
        'needs it (see apps/web/.env.example, or the e2e CI job env).',
    );
  }
  return url;
}

async function currentPolicyVersion(): Promise<string | null> {
  const api = createApiClient({ baseUrl: apiBaseUrl() });
  // No declared error response for this path (contract/countries.ts) makes
  // openapi-fetch's `error` field statically `never`; a real failure throws
  // instead of returning one.
  const { data } = await api.GET('/v1/policy-version');
  if (!data) {
    throw new Error('seedConsentCookie: GET /v1/policy-version returned no data');
  }
  return data.policyVersion;
}

// docs/steps/1B.12-web-e2e.md "the consent banner is pre-seeded, never
// clicked": a transient overlay can steal a click meant for the page under
// it, exactly auth.setup.ts's own native-submit race shape, so every spec
// removes it from the state entirely instead of timing a dismissal.
// Rejected, not accepted, to match the realistic first-visit default 1B.11
// already established for its own budget.
export async function seedConsentCookie(context: BrowserContext, baseURL: string): Promise<void> {
  const policyVersion = await currentPolicyVersion();
  const decision = buildDecision({ analytics: false, adsMarketing: false }, policyVersion);

  await context.addCookies([
    {
      name: CONSENT_COOKIE_NAME,
      value: encodeConsentCookieValue(decision),
      url: baseURL,
      expires: Math.floor(Date.now() / 1000) + CONSENT_COOKIE_MAX_AGE_SECONDS,
      sameSite: 'Lax',
    },
  ]);
}
