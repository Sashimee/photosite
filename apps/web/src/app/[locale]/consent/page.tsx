import { cookies } from 'next/headers';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';

import type { components } from '@photoo/api-client';

import { isLocale, type Locale } from '@photoo/shared';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { api } from '@/lib/api';
import {
  CATEGORY_PURPOSES,
  CONSENT_COOKIE_NAME,
  decodeConsentCookieValue,
  isPolicyVersionNewer,
  type ConsentCategory,
} from '@/lib/consent';
import { buildRobotsMetadata } from '@/lib/robots';
import { getSession, serverApi } from '@/lib/session';

import { acceptAllAction, rejectAllAction, savePreferencesAction } from './actions';

type ConsentStateEntry = components['schemas']['ConsentStateEntry'];

interface CategoryState {
  granted: boolean;
  recordedAt: string | null;
  policyVersion: string | null;
}

function categoryStateFromEntries(
  entries: ConsentStateEntry[],
): Record<ConsentCategory, CategoryState> {
  const byPurpose = new Map(entries.map((entry) => [entry.purpose, entry]));

  function stateFor(category: ConsentCategory): CategoryState {
    const relevant = CATEGORY_PURPOSES[category]
      .map((purpose) => byPurpose.get(purpose))
      .filter((entry): entry is ConsentStateEntry => entry !== undefined);

    return {
      granted: relevant.length > 0 && relevant.every((entry) => entry.granted),
      recordedAt: relevant.reduce<string | null>(
        (latest, entry) =>
          entry.recordedAt && (!latest || entry.recordedAt > latest) ? entry.recordedAt : latest,
        null,
      ),
      policyVersion: relevant[0]?.policyVersion ?? null,
    };
  }

  return { analytics: stateFor('analytics'), adsMarketing: stateFor('adsMarketing') };
}

async function loadCategoryState(): Promise<Record<ConsentCategory, CategoryState>> {
  const user = await getSession();

  if (user) {
    const authedApi = await serverApi();
    const { data } = await authedApi.GET('/v1/me/consents');
    return categoryStateFromEntries(data?.consents ?? []);
  }

  const cookieStore = await cookies();
  const decision = decodeConsentCookieValue(cookieStore.get(CONSENT_COOKIE_NAME)?.value);
  const stateFor = (category: ConsentCategory): CategoryState => ({
    granted: decision?.categories[category] ?? false,
    recordedAt: decision?.decidedAt ?? null,
    policyVersion: decision?.policyVersion ?? null,
  });
  return { analytics: stateFor('analytics'), adsMarketing: stateFor('adsMarketing') };
}

// Public and unguarded (docs/steps/1B.10-consent.md requires it reachable
// without a session), but with no content unique to a given visitor, so it
// opts out of indexing deliberately rather than by the session-guard rule
// `private-routes-noindex.test.ts` checks elsewhere.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) {
    return {};
  }
  const t = await getTranslations({ locale, namespace: 'web.consent.settings' });
  return { title: t('title'), robots: buildRobotsMetadata(false) };
}

export default async function ConsentSettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: requestedLocale } = await params;
  if (!isLocale(requestedLocale)) {
    notFound();
  }
  const locale: Locale = requestedLocale;

  const [t, tCategories, categoryState, policyVersionResult] = await Promise.all([
    getTranslations({ locale, namespace: 'web.consent.settings' }),
    getTranslations({ locale, namespace: 'web.consent.categories' }),
    loadCategoryState(),
    api.GET('/v1/policy-version'),
  ]);
  const currentPolicyVersion = policyVersionResult.data?.policyVersion ?? null;

  const outdated = (Object.keys(categoryState) as ConsentCategory[]).some(
    (category) =>
      categoryState[category].recordedAt !== null &&
      isPolicyVersionNewer(currentPolicyVersion, categoryState[category].policyVersion),
  );

  function statusFor(category: ConsentCategory) {
    const state = categoryState[category];
    if (!state.recordedAt) {
      return t('notDecidedYet');
    }
    return t('decidedUnder', {
      policyVersion: state.policyVersion ?? '—',
      date: new Date(state.recordedAt).toLocaleDateString(locale),
    });
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-16">
      <div>
        <h1 className="text-3xl font-semibold text-foreground">{t('title')}</h1>
        <p className="mt-4 text-muted-foreground">{t('intro')}</p>
        {outdated ? (
          <p className="mt-4 rounded-md border border-border bg-muted px-4 py-3 text-sm text-foreground">
            {t('policyUpdated')}
          </p>
        ) : null}
      </div>

      <form className="flex flex-col gap-8">
        <input type="hidden" name="locale" value={locale} />

        <div className="flex items-start justify-between gap-4">
          <div>
            <Label htmlFor="consent-necessary" className="text-foreground">
              {tCategories('necessary.title')}
            </Label>
            <p className="text-sm text-muted-foreground">{tCategories('necessary.description')}</p>
          </div>
          <Switch id="consent-necessary" checked disabled />
        </div>

        <div className="flex items-start justify-between gap-4">
          <div>
            <Label htmlFor="consent-analytics" className="text-foreground">
              {tCategories('analytics.title')}
            </Label>
            <p className="text-sm text-muted-foreground">{tCategories('analytics.description')}</p>
            <p className="mt-1 text-xs text-muted-foreground">{statusFor('analytics')}</p>
          </div>
          <Switch
            id="consent-analytics"
            name="analytics"
            defaultChecked={categoryState.analytics.granted}
          />
        </div>

        <div className="flex items-start justify-between gap-4">
          <div>
            <Label htmlFor="consent-ads-marketing" className="text-foreground">
              {tCategories('adsMarketing.title')}
            </Label>
            <p className="text-sm text-muted-foreground">
              {tCategories('adsMarketing.description')}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{statusFor('adsMarketing')}</p>
          </div>
          <Switch
            id="consent-ads-marketing"
            name="adsMarketing"
            defaultChecked={categoryState.adsMarketing.granted}
          />
        </div>

        <div className="flex flex-wrap gap-3">
          <Button type="submit" formAction={acceptAllAction} variant="default">
            {t('acceptAll')}
          </Button>
          <Button type="submit" formAction={rejectAllAction} variant="default">
            {t('rejectAll')}
          </Button>
          <Button type="submit" formAction={savePreferencesAction} variant="outline">
            {t('savePreferences')}
          </Button>
        </div>
      </form>
    </main>
  );
}
