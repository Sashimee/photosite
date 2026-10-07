import {
  CATEGORY_PURPOSES,
  CONSENT_CATEGORIES,
  type ConsentCategoryGrants,
  type ConsentPurpose,
} from '@photoo/shared';
import * as SecureStore from 'expo-secure-store';

const DECISION_KEY = 'photoo.consent.decision';
const ANONYMOUS_ID_KEY = 'photoo.consent.anonymousId';

const STORE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export interface ConsentDecision {
  policyVersion: string | null;
  decidedAt: string;
  categories: ConsentCategoryGrants;
}

export function buildDecision(
  categories: ConsentCategoryGrants,
  policyVersion: string | null,
): ConsentDecision {
  return { policyVersion, decidedAt: new Date().toISOString(), categories };
}

export function grantsToPurposes(
  categories: ConsentCategoryGrants,
): { purpose: ConsentPurpose; granted: boolean }[] {
  return CONSENT_CATEGORIES.flatMap((category) =>
    CATEGORY_PURPOSES[category].map((purpose) => ({ purpose, granted: categories[category] })),
  );
}

function parseDecision(raw: string): ConsentDecision | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) {
      return null;
    }
    const { policyVersion, decidedAt, categories } = value as Record<string, unknown>;
    const grants = categories as Record<string, unknown> | null;
    if (
      (policyVersion !== null && typeof policyVersion !== 'string') ||
      typeof decidedAt !== 'string' ||
      typeof grants !== 'object' ||
      grants === null ||
      typeof grants.analytics !== 'boolean' ||
      typeof grants.adsMarketing !== 'boolean'
    ) {
      return null;
    }
    return {
      policyVersion,
      decidedAt,
      categories: { analytics: grants.analytics, adsMarketing: grants.adsMarketing },
    };
  } catch {
    return null;
  }
}

export async function getStoredDecision(): Promise<ConsentDecision | null> {
  const raw = await SecureStore.getItemAsync(DECISION_KEY, STORE_OPTIONS);
  return raw ? parseDecision(raw) : null;
}

export async function setStoredDecision(decision: ConsentDecision): Promise<void> {
  await SecureStore.setItemAsync(DECISION_KEY, JSON.stringify(decision), STORE_OPTIONS);
}

export async function getAnonymousId(): Promise<string | null> {
  return SecureStore.getItemAsync(ANONYMOUS_ID_KEY, STORE_OPTIONS);
}

export async function getOrCreateAnonymousId(): Promise<string> {
  const existing = await getAnonymousId();
  if (existing) {
    return existing;
  }
  const created = globalThis.crypto.randomUUID();
  await SecureStore.setItemAsync(ANONYMOUS_ID_KEY, created, STORE_OPTIONS);
  return created;
}

export async function clearAnonymousId(): Promise<void> {
  await SecureStore.deleteItemAsync(ANONYMOUS_ID_KEY, STORE_OPTIONS);
}
