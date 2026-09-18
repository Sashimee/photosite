import { ActivityIndicator, Pressable, Text } from 'react-native';

export function PrimaryButton({
  label,
  onPress,
  disabled,
  loading,
  testID,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  testID?: string;
}) {
  const isDisabled = Boolean(disabled) || Boolean(loading);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled }}
      onPress={onPress}
      disabled={isDisabled}
      testID={testID}
      className={`items-center rounded-md bg-primary px-4 py-3 ${isDisabled ? 'opacity-50' : ''}`}
    >
      {loading ? (
        <ActivityIndicator color="#fafafa" />
      ) : (
        <Text className="text-base font-medium text-primary-foreground">{label}</Text>
      )}
    </Pressable>
  );
}
