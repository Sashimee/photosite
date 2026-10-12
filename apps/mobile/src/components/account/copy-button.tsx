import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text } from 'react-native';

export function CopyButton({
  label,
  value,
  testID,
}: {
  label: string;
  value: string;
  testID: string;
}) {
  const { t } = useTranslation();
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');

  async function copy() {
    try {
      await Clipboard.setStringAsync(value);
      setState('copied');
    } catch {
      setState('failed');
    }
  }

  return (
    <>
      <Pressable
        accessibilityRole="button"
        onPress={() => void copy()}
        testID={testID}
        className="min-h-11 items-center justify-center rounded-md border border-border px-4 py-3"
      >
        <Text className="text-base font-medium text-foreground">{label}</Text>
      </Pressable>
      {state === 'copied' ? (
        <Text className="text-sm text-muted-foreground" testID={`${testID}-copied`}>
          {t('mobile.account.twoFactor.enroll.copied')}
        </Text>
      ) : null}
      {state === 'failed' ? (
        <Text className="text-sm text-destructive" testID={`${testID}-failed`}>
          {t('mobile.account.twoFactor.enroll.copyFailed')}
        </Text>
      ) : null}
    </>
  );
}
