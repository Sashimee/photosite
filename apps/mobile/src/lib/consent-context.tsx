import { isPolicyVersionNewer, type ConsentCategoryGrants } from '@photoo/shared';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';

import { useAuth } from './auth-context';
import { persistConsentDecision, fetchPolicyVersion } from './consent-sync';
import {
  buildDecision,
  getStoredDecision,
  setStoredDecision,
  type ConsentDecision,
} from './consent-store';

export interface ConsentContextValue {
  ready: boolean;
  decision: ConsentDecision | null;
  analyticsEnabled: boolean;
  promptVisible: boolean;
  decide: (categories: ConsentCategoryGrants) => Promise<void>;
}

const ConsentContext = createContext<ConsentContextValue | null>(null);

export function ConsentProvider({ children }: PropsWithChildren) {
  const { user } = useAuth();
  const signedIn = user !== null;
  const [decision, setDecision] = useState<ConsentDecision | null>(null);
  const [policyVersion, setPolicyVersion] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const decidedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      getStoredDecision().catch((error: unknown) => {
        console.error('Failed to read the stored consent decision', error);
        return null;
      }),
      fetchPolicyVersion(),
    ]).then(([stored, version]) => {
      if (cancelled) {
        return;
      }
      if (!decidedRef.current) {
        setDecision(stored);
      }
      setPolicyVersion(version);
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const decide = useCallback(
    async (categories: ConsentCategoryGrants) => {
      const next = buildDecision(categories, policyVersion);
      decidedRef.current = true;
      setDecision(next);
      setReady(true);
      try {
        await setStoredDecision(next);
      } catch (error) {
        console.error('Failed to store the consent decision on this device', error);
      }
      await persistConsentDecision(categories, signedIn);
    },
    [policyVersion, signedIn],
  );

  const value = useMemo<ConsentContextValue>(
    () => ({
      ready,
      decision,
      analyticsEnabled: decision?.categories.analytics === true,
      promptVisible:
        ready && (decision === null || isPolicyVersionNewer(policyVersion, decision.policyVersion)),
      decide,
    }),
    [ready, decision, policyVersion, decide],
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

export function useAnalyticsEnabled(): boolean {
  return useConsent().analyticsEnabled;
}
