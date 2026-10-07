import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

export function StudioFrame({ title, children }: { title: string; children: ReactNode }) {
  const { t } = useTranslation();
  const router = useRouter();

  return (
    <View className="flex-1 bg-background pt-12">
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          if (router.canGoBack()) {
            router.back();
          } else {
            router.replace('/account');
          }
        }}
        testID="studio-back"
        className="min-h-11 min-w-11 justify-center self-start px-4"
      >
        <Text className="text-base font-medium text-foreground">{t('mobile.studio.back')}</Text>
      </Pressable>
      <Text className="px-6 pb-2 text-2xl font-semibold text-foreground" accessibilityRole="header">
        {title}
      </Text>
      {children}
    </View>
  );
}

export function StudioLoading({ testID }: { testID: string }) {
  return (
    <View className="flex-1 items-center justify-center">
      <ActivityIndicator testID={testID} />
    </View>
  );
}

export function StudioMessage({
  testID,
  tone = 'error',
  message,
  actionLabel,
  onAction,
  actionTestID,
}: {
  testID: string;
  tone?: 'error' | 'info';
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  actionTestID?: string;
}) {
  return (
    <View className="flex-1 items-center justify-center gap-4 p-6" testID={testID}>
      <Text
        className={`text-center ${tone === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}
        accessibilityRole={tone === 'error' ? 'alert' : 'text'}
      >
        {message}
      </Text>
      {actionLabel && onAction ? (
        <Pressable
          accessibilityRole="button"
          onPress={onAction}
          testID={actionTestID}
          className="min-h-11 justify-center"
        >
          <Text className="text-base font-medium text-foreground underline">{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
