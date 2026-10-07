import type { ConsentPurpose } from './enums.js';

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

// `policyVersion` is a plain incrementing integer as a string, and `null`
// means nothing has ever been published; both cases collapse to the same low
// rank so a decision made during an outage (stored `null`) isn't re-prompted
// for as long as the published version stays unset, but is re-prompted the
// moment a real version appears.
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
