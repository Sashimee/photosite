'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { isLocale, type Locale } from '@photoo/shared';

import { api } from '@/lib/api';
import {
  buildDecision,
  CATEGORY_PURPOSES,
  CONSENT_COOKIE_MAX_AGE_SECONDS,
  CONSENT_COOKIE_NAME,
  encodeConsentCookieValue,
  isAnalyticsCookieName,
  type ConsentCategory,
  type ConsentCategoryGrants,
} from '@/lib/consent';
import { getSession, serverApi } from '@/lib/session';

function localeFromFormData(formData: FormData): Locale {
  const value = formData.get('locale');
  return typeof value === 'string' && isLocale(value) ? value : 'en';
}

function checkboxOn(formData: FormData, name: string): boolean {
  return formData.get(name) === 'on';
}

async function currentPolicyVersion(): Promise<string | null> {
  try {
    const { data } = await api.GET('/v1/policy-version');
    return data?.policyVersion ?? null;
  } catch (error) {
    console.error('Failed to load the published policy version', error);
    return null;
  }
}

// Shared by every button on the settings form (accept all, reject all, save
// preferences): applies the cookie unconditionally, clears analytics
// cookies on refusal, then tries the server write. The write failing must
// never stop the redirect - the visitor's choice already took effect
// (docs/steps/1B.10-consent.md task 4).
async function recordAndRedirect(locale: Locale, categories: ConsentCategoryGrants): Promise<void> {
  const policyVersion = await currentPolicyVersion();
  const decision = buildDecision(categories, policyVersion);
  const cookieStore = await cookies();

  cookieStore.set(CONSENT_COOKIE_NAME, encodeConsentCookieValue(decision), {
    path: '/',
    maxAge: CONSENT_COOKIE_MAX_AGE_SECONDS,
    sameSite: 'lax',
    secure: true,
  });

  if (!categories.analytics) {
    for (const cookie of cookieStore.getAll()) {
      if (isAnalyticsCookieName(cookie.name)) {
        cookieStore.delete(cookie.name);
      }
    }
  }

  const grants = (Object.entries(categories) as [ConsentCategory, boolean][]).flatMap(
    ([category, granted]) => CATEGORY_PURPOSES[category].map((purpose) => ({ purpose, granted })),
  );

  const user = await getSession();
  if (user) {
    try {
      const authedApi = await serverApi();
      const { error } = await authedApi.PUT('/v1/me/consents', { body: { consents: grants } });
      if (error) {
        console.error('Failed to record consent decision', error);
      }
    } catch (error) {
      console.error('Failed to record consent decision', error);
    }
  } else {
    // One purpose per `POST /v1/consents` call, but one act of consent:
    // every call in this decision shares a single anonymousId so the
    // resulting rows can be shown to belong together.
    // TODO(#231): whether this id should persist across decisions or be
    // linked at sign-up is an open privacy question: 1B.10-consent.md says
    // anonymous records are never retro-linked, 1A.12-gdpr.md and #227 link
    // them at sign-up. Throwaway-per-decision is the conservative reading
    // until that is decided.
    const anonymousId = crypto.randomUUID();
    const results = await Promise.all(
      grants.map(async ({ purpose, granted }) => {
        try {
          const { error } = await api.POST('/v1/consents', {
            body: { anonymousId, purpose, granted },
          });
          return { purpose, ok: !error, error };
        } catch (error) {
          return { purpose, ok: false, error };
        }
      }),
    );

    const recorded = results.filter((result) => result.ok).map((result) => result.purpose);
    const failures = results.filter((result) => !result.ok);

    if (failures.length > 0) {
      console.error(
        `Failed to record part of a consent decision (anonymousId ${anonymousId}): ` +
          `recorded [${recorded.join(', ')}], not recorded [${failures.map((failure) => failure.purpose).join(', ')}]`,
        failures.map((failure) => failure.error),
      );
    }
  }

  redirect(`/${locale}/consent`);
}

export async function acceptAllAction(formData: FormData): Promise<void> {
  await recordAndRedirect(localeFromFormData(formData), { analytics: true, adsMarketing: true });
}

export async function rejectAllAction(formData: FormData): Promise<void> {
  await recordAndRedirect(localeFromFormData(formData), { analytics: false, adsMarketing: false });
}

export async function savePreferencesAction(formData: FormData): Promise<void> {
  await recordAndRedirect(localeFromFormData(formData), {
    analytics: checkboxOn(formData, 'analytics'),
    adsMarketing: checkboxOn(formData, 'adsMarketing'),
  });
}
