import { z } from 'zod';

import {
  CATEGORY_PURPOSES,
  CONSENT_CATEGORIES,
  isPolicyVersionNewer,
  type ConsentCategory,
  type ConsentCategoryGrants,
} from '@photoo/shared';

export const CONSENT_COOKIE_NAME = 'photoo_consent';

export const CONSENT_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export interface ConsentDecision {
  policyVersion: string | null;
  decidedAt: string;
  categories: ConsentCategoryGrants;
}

const ConsentCookieSchema = z
  .object({
    policyVersion: z.string().min(1).max(20).nullable(),
    decidedAt: z.iso.datetime({ offset: true }),
    categories: z
      .object({
        analytics: z.boolean(),
        adsMarketing: z.boolean(),
      })
      .strict(),
  })
  .strict();

export function buildDecision(
  categories: ConsentCategoryGrants,
  policyVersion: string | null,
): ConsentDecision {
  return { policyVersion, decidedAt: new Date().toISOString(), categories };
}

// The cookie is first-party evidence of a choice, not an identifier: it
// never carries a userId or anonymousId (docs/steps/1B.10-consent.md
// "Decisions for this step"). `{}":,` inside the JSON aren't valid raw
// cookie-value characters, so the value is percent-encoded the same way on
// both the client (document.cookie) and the server (Next's cookies() API).
export function encodeConsentCookieValue(decision: ConsentDecision): string {
  return encodeURIComponent(JSON.stringify(decision));
}

export function decodeConsentCookieValue(raw: string | undefined | null): ConsentDecision | null {
  if (!raw) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(decodeURIComponent(raw));
    const result = ConsentCookieSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export { CATEGORY_PURPOSES, CONSENT_CATEGORIES, isPolicyVersionNewer };
export type { ConsentCategory, ConsentCategoryGrants };

export function needsReprompt(
  decision: ConsentDecision | null,
  currentPolicyVersion: string | null,
): boolean {
  if (!decision) {
    return true;
  }
  return isPolicyVersionNewer(currentPolicyVersion, decision.policyVersion);
}

// GA4's own cookies: `_ga`, `_gid`, and the property-scoped `_ga_<ID>`
// variant. No GTM/GA4 id exists yet (1B.10b), but withdrawal must clear
// these immediately if a later grant ever set them.
export function isAnalyticsCookieName(name: string): boolean {
  return name === '_ga' || name === '_gid' || name.startsWith('_ga_');
}
