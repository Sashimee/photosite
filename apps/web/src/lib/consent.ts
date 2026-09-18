import { z } from 'zod';

import type { ConsentPurpose } from '@photoo/shared';

export const CONSENT_COOKIE_NAME = 'photoo_consent';

export const CONSENT_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

// docs/COMPLIANCE.md fixes three categories: necessary (always on, never
// stored as a purpose), analytics, and ads/marketing shown as a single
// toggle. `ads` and `marketing` stay two purposes server-side (the API
// records evidence per purpose), so a category maps to one or more purposes.
export const CONSENT_CATEGORIES = ['analytics', 'adsMarketing'] as const;

export type ConsentCategory = (typeof CONSENT_CATEGORIES)[number];

export const CATEGORY_PURPOSES: Record<ConsentCategory, ConsentPurpose[]> = {
  analytics: ['analytics'],
  adsMarketing: ['ads', 'marketing'],
};

export type ConsentCategoryGrants = Record<ConsentCategory, boolean>;

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

// `policyVersion` is a plain incrementing integer as a string, and `null`
// means nothing has ever been published (docs/steps/1B.10-consent.md); both
// cases collapse to the same low rank so a decision made during an outage
// (stored `policyVersion: null`) isn't re-prompted for as long as the
// published version stays unset, but is re-prompted the moment a real
// version appears.
function versionRank(version: string | null): number {
  if (version === null) {
    return -1;
  }
  const parsed = Number(version);
  return Number.isFinite(parsed) ? parsed : -1;
}

export function isPolicyVersionNewer(current: string | null, stored: string | null): boolean {
  return versionRank(current) > versionRank(stored);
}

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
