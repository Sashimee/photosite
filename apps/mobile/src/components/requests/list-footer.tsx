import { ActivityIndicator, Pressable, Text, View } from 'react-native';

export function ListFooter({
  failed,
  loadingMore,
  failedLabel,
  retryLabel,
  onRetry,
  testID,
}: {
  failed: boolean;
  loadingMore: boolean;
  failedLabel: string;
  retryLabel: string;
  onRetry: () => void;
  testID: string;
}) {
  if (failed) {
    return (
      <View
        className="items-center gap-1 py-4"
        testID={`${testID}-error`}
        accessibilityRole="alert"
      >
        <Text className="text-sm text-destructive">{failedLabel}</Text>
        <Pressable
          accessibilityRole="button"
          onPress={onRetry}
          testID={`${testID}-retry`}
          className="min-h-11 justify-center"
        >
          <Text className="text-sm font-medium text-foreground underline">{retryLabel}</Text>
        </Pressable>
      </View>
    );
  }
  return loadingMore ? <ActivityIndicator className="py-4" testID={`${testID}-loading`} /> : null;
}
