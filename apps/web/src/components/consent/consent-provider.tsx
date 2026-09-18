'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { api } from '@/lib/api';
import {
  buildDecision,
  CATEGORY_PURPOSES,
  CONSENT_COOKIE_MAX_AGE_SECONDS,
  CONSENT_COOKIE_NAME,
  decodeConsentCookieValue,
  encodeConsentCookieValue,
  isAnalyticsCookieName,
  needsReprompt,
  type ConsentCategory,
  type ConsentCategoryGrants,
  type ConsentDecision,
} from '@/lib/consent';
import { pushConsentUpdate } from '@/lib/consent-mode';
import { useSession } from '@/lib/use-session';

export interface ConsentContextValue {
  decision: ConsentDecision | null;
  bannerVisible: boolean;
  manageOpen: boolean;
  openManage: () => void;
  closeManage: () => void;
  acceptAll: () => void;
  rejectAll: () => void;
  savePreferences: (categories: ConsentCategoryGrants) => void;
}

const ConsentContext = createContext<ConsentContextValue | null>(null);

function readCookieDecision(): ConsentDecision | null {
  if (typeof document === 'undefined') {
    return null;
  }
  const prefix = `${CONSENT_COOKIE_NAME}=`;
  const row = document.cookie.split('; ').find((entry) => entry.startsWith(prefix));
  return row ? decodeConsentCookieValue(row.slice(prefix.length)) : null;
}

function writeCookieDecision(decision: ConsentDecision): void {
  const value = encodeConsentCookieValue(decision);
  document.cookie = `${CONSENT_COOKIE_NAME}=${value}; path=/; max-age=${String(CONSENT_COOKIE_MAX_AGE_SECONDS)}; samesite=lax; secure`;
}

// A refusal takes effect immediately, not just for future loads: any
// analytics cookie a previous grant already set is deleted the moment
// analytics is denied (docs/steps/1B.10-consent.md "Withdrawal takes effect
// immediately").
function clearAnalyticsCookies(): void {
  if (typeof document === 'undefined') {
    return;
  }
  for (const entry of document.cookie.split('; ')) {
    const name = entry.split('=')[0];
    if (name && isAnalyticsCookieName(name)) {
      document.cookie = `${name}=; path=/; max-age=0; samesite=lax; secure`;
    }
  }
}

export function ConsentProvider({
  policyVersion,
  children,
}: {
  policyVersion: string | null;
  children: ReactNode;
}) {
  const { user } = useSession();
  const [decision, setDecision] = useState<ConsentDecision | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);

  // The decision lives in a cookie the server-rendered HTML never reads, so
  // pages stay cacheable and the banner can only show up after hydration
  // instead of blocking or flashing on first paint.
  useEffect(() => {
    setDecision(readCookieDecision());
    setHydrated(true);
  }, []);

  const record = useCallback(
    (categories: ConsentCategoryGrants) => {
      const grants = (Object.entries(categories) as [ConsentCategory, boolean][]).flatMap(
        ([category, granted]) =>
          CATEGORY_PURPOSES[category].map((purpose) => ({ purpose, granted })),
      );

      // A visitor's decision must never depend on our API being up: the
      // cookie and the in-memory state are already applied before this
      // runs, so a failed write only loses the server-side evidence record,
      // never the choice itself (docs/steps/1B.10-consent.md task 4).
      // openapi-fetch resolves (rather than rejects) an HTTP error response
      // as `{ error }` - policyVersion being unset is a 500 by design until
      // an admin publishes one - so both that and a thrown network failure
      // are logged the same way, never surfaced to the visitor.
      async function write() {
        if (user) {
          try {
            const { error } = await api.PUT('/v1/me/consents', { body: { consents: grants } });
            if (error) {
              console.error('Failed to record consent decision', error);
            }
          } catch (error) {
            console.error('Failed to record consent decision', error);
          }
          return;
        }

        // One purpose per `POST /v1/consents` call, but one act of consent:
        // every call in this decision shares a single anonymousId so the
        // resulting rows can be shown to belong together, rather than
        // reading as unrelated anonymous identities.
        // TODO(#231): whether this id should persist across decisions or be
        // linked at sign-up is an open privacy question: 1B.10-consent.md says
        // anonymous records are never retro-linked, 1A.12-gdpr.md and #227
        // link them at sign-up. Throwaway-per-decision is the conservative
        // reading until that is decided.
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

      void write();
    },
    [user],
  );

  const applyDecision = useCallback(
    (categories: ConsentCategoryGrants) => {
      const next = buildDecision(categories, policyVersion);
      setDecision(next);
      writeCookieDecision(next);
      pushConsentUpdate(categories);
      if (!categories.analytics) {
        clearAnalyticsCookies();
      }
      setManageOpen(false);
      record(categories);
    },
    [policyVersion, record],
  );

  const acceptAll = useCallback(() => {
    applyDecision({ analytics: true, adsMarketing: true });
  }, [applyDecision]);

  const rejectAll = useCallback(() => {
    applyDecision({ analytics: false, adsMarketing: false });
  }, [applyDecision]);

  const openManage = useCallback(() => {
    setManageOpen(true);
  }, []);

  const closeManage = useCallback(() => {
    setManageOpen(false);
  }, []);

  const bannerVisible = hydrated && needsReprompt(decision, policyVersion);

  const value = useMemo<ConsentContextValue>(
    () => ({
      decision,
      bannerVisible,
      manageOpen,
      openManage,
      closeManage,
      acceptAll,
      rejectAll,
      savePreferences: applyDecision,
    }),
    [
      decision,
      bannerVisible,
      manageOpen,
      openManage,
      closeManage,
      acceptAll,
      rejectAll,
      applyDecision,
    ],
  );

  return <ConsentContext.Provider value={value}>{children}</ConsentContext.Provider>;
}

export function useConsent(): ConsentContextValue {
  const context = useContext(ConsentContext);
  if (!context) {
    throw new Error('useConsent must be used within a ConsentProvider');
  }
  return context;
}
