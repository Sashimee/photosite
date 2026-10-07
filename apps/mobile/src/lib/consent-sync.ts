import { CATEGORY_PURPOSES, type ConsentCategoryGrants } from '@photoo/shared';

import { api } from './api';
import { getOrCreateAnonymousId, grantsToPurposes } from './consent-store';

const RATE_LIMITED = 429;

function describeFailure(error: unknown, response: Response | undefined): string {
  if (response?.status === RATE_LIMITED) {
    const retryAfter = (error as { details?: { retryAfterSeconds?: number } } | undefined)?.details
      ?.retryAfterSeconds;
    return retryAfter === undefined
      ? 'rate limited'
      : `rate limited, retry after ${String(retryAfter)}s`;
  }
  return response ? `HTTP ${String(response.status)}` : 'network error';
}

export async function persistConsentDecision(
  categories: ConsentCategoryGrants,
  signedIn: boolean,
): Promise<void> {
  const grants = grantsToPurposes(categories);

  if (signedIn) {
    try {
      const { error, response } = await api.PUT('/v1/me/consents', { body: { consents: grants } });
      if (error) {
        console.error(
          `Failed to record consent decision (${describeFailure(error, response)})`,
          error,
        );
      }
    } catch (error) {
      console.error('Failed to record consent decision (network error)', error);
    }
    return;
  }

  let anonymousId: string;
  try {
    anonymousId = await getOrCreateAnonymousId();
  } catch (error) {
    console.error('Failed to create an anonymous consent id; decision kept on device only', error);
    return;
  }

  const results = await Promise.all(
    grants.map(async ({ purpose, granted }) => {
      try {
        const { error, response } = await api.POST('/v1/consents', {
          body: { anonymousId, purpose, granted },
        });
        return { purpose, error: error ? describeFailure(error, response) : null, cause: error };
      } catch (cause) {
        return { purpose, error: 'network error', cause };
      }
    }),
  );

  const failures = results.filter((result) => result.error !== null);
  if (failures.length > 0) {
    console.error(
      `Failed to record part of a consent decision: not recorded [${failures
        .map((failure) => `${failure.purpose}: ${String(failure.error)}`)
        .join(', ')}]`,
      failures.map((failure) => failure.cause),
    );
  }
}

export async function fetchServerGrants(): Promise<ConsentCategoryGrants | null> {
  try {
    const { data, error, response } = await api.GET('/v1/me/consents');
    if (!data) {
      console.error(`Failed to load consent state (${describeFailure(error, response)})`, error);
      return null;
    }
    const granted = new Set(data.consents.filter((entry) => entry.granted).map((e) => e.purpose));
    return {
      analytics: CATEGORY_PURPOSES.analytics.every((purpose) => granted.has(purpose)),
      adsMarketing: CATEGORY_PURPOSES.adsMarketing.every((purpose) => granted.has(purpose)),
    };
  } catch (error) {
    console.error('Failed to load consent state (network error)', error);
    return null;
  }
}

export async function fetchPolicyVersion(): Promise<string | null> {
  try {
    const { data } = await api.GET('/v1/policy-version');
    return data?.policyVersion ?? null;
  } catch (error) {
    console.error('Failed to load the published policy version', error);
    return null;
  }
}
