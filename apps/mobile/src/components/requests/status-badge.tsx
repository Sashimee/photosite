import { Text, View } from 'react-native';

export function StatusBadge({
  label,
  muted = false,
  testID,
}: {
  label: string;
  muted?: boolean;
  testID?: string;
}) {
  return (
    <View
      testID={testID}
      className={`self-start rounded-full px-2 py-0.5 ${muted ? 'border border-border' : 'bg-secondary'}`}
    >
      <Text
        className={`text-xs font-medium ${muted ? 'text-muted-foreground' : 'text-secondary-foreground'}`}
      >
        {label}
      </Text>
    </View>
  );
}

export const TERMINAL_REQUEST_STATUSES: readonly string[] = ['closed', 'cancelled'];
export const TERMINAL_QUOTE_STATUSES: readonly string[] = ['declined', 'expired', 'withdrawn'];
