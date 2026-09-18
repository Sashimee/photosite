import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { openLocationSettings, requestCurrentPosition, type Coordinates } from '../../lib/location';

type Status = 'idle' | 'locating' | 'denied';

export function NearMeButton({ onLocated }: { onLocated: (coordinates: Coordinates) => void }) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<Status>('idle');

  async function handlePress() {
    setStatus('locating');
    const result = await requestCurrentPosition();
    if (result.granted) {
      setStatus('idle');
      onLocated(result.coordinates);
      return;
    }
    setStatus('denied');
  }

  return (
    <View className="gap-2">
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: status === 'locating' }}
        accessibilityLabel={t('mobile.discovery.nearMe.button')}
        onPress={() => void handlePress()}
        disabled={status === 'locating'}
        testID="near-me-button"
        className="min-h-11 min-w-11 items-center justify-center rounded-md border border-input px-4 py-3"
      >
        {status === 'locating' ? (
          <ActivityIndicator testID="near-me-locating" />
        ) : (
          <Text className="text-sm font-medium text-foreground">
            {t('mobile.discovery.nearMe.button')}
          </Text>
        )}
      </Pressable>
      {status === 'denied' ? (
        <View className="gap-1" testID="near-me-denied" accessibilityRole="alert">
          <Text className="text-sm text-muted-foreground">
            {t('mobile.discovery.nearMe.deniedExplanation')}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => void openLocationSettings()}
            testID="near-me-open-settings"
            className="min-h-11 justify-center"
          >
            <Text className="text-sm font-medium text-foreground underline">
              {t('mobile.discovery.nearMe.openSettings')}
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}
