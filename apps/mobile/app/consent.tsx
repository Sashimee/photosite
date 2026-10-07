import type { ConsentCategoryGrants } from '@photoo/shared';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';

import { ConsentPanel } from '../src/components/consent/consent-panel';
import { useAuth } from '../src/lib/auth-context';
import { useConsent } from '../src/lib/consent-context';
import { fetchServerGrants } from '../src/lib/consent-sync';

const NONE: ConsentCategoryGrants = { analytics: false, adsMarketing: false };

export default function ConsentScreen() {
  const { t } = useTranslation();
  const { status } = useAuth();
  const { ready, decision, decide } = useConsent();
  const decisionRef = useRef(decision);
  decisionRef.current = decision;
  const [initial, setInitial] = useState<ConsentCategoryGrants | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (status === 'loading' || !ready) {
      return;
    }
    let cancelled = false;
    const local = decisionRef.current?.categories ?? NONE;
    if (status !== 'signed-in') {
      setInitial(local);
      return;
    }
    void fetchServerGrants().then((server) => {
      if (!cancelled) {
        setInitial(server ?? local);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [status, ready]);

  if (initial === null) {
    return (
      <View className="flex-1 items-center justify-center bg-background" testID="consent-loading">
        <Text className="text-muted-foreground">{t('mobile.consent.loading')}</Text>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-background">
      <ConsentPanel
        key={`${String(initial.analytics)}-${String(initial.adsMarketing)}`}
        initial={initial}
        notice={saved ? t('mobile.consent.saved') : null}
        onDecide={(categories) => {
          setSaved(true);
          void decide(categories);
        }}
      />
    </View>
  );
}
