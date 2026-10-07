import type { ConsentCategoryGrants } from '@photoo/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';

import { ConsentPanel } from '../src/components/consent/consent-panel';
import { useConsent } from '../src/lib/consent-context';

const NONE: ConsentCategoryGrants = { analytics: false, adsMarketing: false };

export default function ConsentScreen() {
  const { t } = useTranslation();
  const { ready, decision, decide } = useConsent();
  const [saved, setSaved] = useState(false);

  if (!ready) {
    return (
      <View className="flex-1 items-center justify-center bg-background" testID="consent-loading">
        <Text className="text-muted-foreground">{t('mobile.consent.loading')}</Text>
      </View>
    );
  }

  const initial = decision?.categories ?? NONE;

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
