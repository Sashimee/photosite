import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';

export function NotificationPrompt({
  onEnable,
  onDismiss,
}: {
  onEnable: () => void;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();

  return (
    <View className="gap-1 border-b border-border bg-muted px-4 py-2" testID="notification-prompt">
      <Text className="text-sm text-foreground">
        {t('mobile.notifications.prompt.explanation')}
      </Text>
      <View className="flex-row gap-4">
        <Pressable
          accessibilityRole="button"
          onPress={onEnable}
          testID="notification-prompt-enable"
          className="min-h-11 justify-center"
        >
          <Text className="text-sm font-medium text-foreground underline">
            {t('mobile.notifications.prompt.enableCta')}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={onDismiss}
          testID="notification-prompt-dismiss"
          className="min-h-11 justify-center"
        >
          <Text className="text-sm text-muted-foreground">
            {t('mobile.notifications.prompt.dismissCta')}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
