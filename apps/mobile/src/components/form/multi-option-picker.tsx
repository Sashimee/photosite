import { Pressable, Text, View } from 'react-native';

import type { PickerOption } from './option-picker';

export function MultiOptionPicker({
  label,
  hint,
  options,
  values,
  onToggle,
  error,
  testID,
}: {
  label: string;
  hint?: string;
  options: PickerOption[];
  values: readonly string[];
  onToggle: (value: string) => void;
  error?: string | undefined;
  testID: string;
}) {
  return (
    <View className="gap-1.5" testID={testID}>
      <Text className="text-sm font-medium text-foreground">{label}</Text>
      {hint ? <Text className="text-sm text-muted-foreground">{hint}</Text> : null}
      <View className="flex-row flex-wrap gap-2">
        {options.map((option) => {
          const checked = values.includes(option.value);
          return (
            <Pressable
              key={option.value}
              accessibilityRole="checkbox"
              accessibilityState={{ checked }}
              onPress={() => {
                onToggle(option.value);
              }}
              testID={`${testID}-${option.value}`}
              className={`min-h-11 justify-center rounded-md border px-3 py-2 ${checked ? 'border-primary bg-primary' : 'border-input bg-background'}`}
            >
              <Text
                className={`text-sm font-medium ${checked ? 'text-primary-foreground' : 'text-foreground'}`}
              >
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {error ? <Text className="text-sm text-destructive">{error}</Text> : null}
    </View>
  );
}
