import type { ReactNode } from 'react';
import { Text, View } from 'react-native';

type Tone = 'error' | 'success' | 'info';

const TONE_BORDER_CLASSES: Record<Tone, string> = {
  error: 'border-destructive',
  success: 'border-border',
  info: 'border-border',
};

const TONE_TEXT_CLASSES: Record<Tone, string> = {
  error: 'text-destructive',
  success: 'text-foreground',
  info: 'text-muted-foreground',
};

export function FormNotice({
  tone,
  children,
  testID,
}: {
  tone: Tone;
  children: ReactNode;
  testID?: string;
}) {
  return (
    <View
      className={`rounded-md border bg-muted px-3 py-2 ${TONE_BORDER_CLASSES[tone]}`}
      testID={testID}
    >
      <Text className={TONE_TEXT_CLASSES[tone]}>{children}</Text>
    </View>
  );
}
