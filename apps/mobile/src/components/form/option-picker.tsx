import { Pressable, Text, View } from 'react-native';

export interface PickerOption {
  value: string;
  label: string;
}

export function OptionPicker({
  label,
  options,
  value,
  onChange,
  error,
  testID,
}: {
  label: string;
  options: PickerOption[];
  value: string;
  onChange: (value: string) => void;
  error?: string | undefined;
  testID?: string;
}) {
  return (
    <View className="gap-1.5" testID={testID}>
      <Text className="text-sm font-medium text-foreground">{label}</Text>
      <View className="flex-row flex-wrap gap-2" accessibilityRole="radiogroup">
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              onPress={() => {
                onChange(option.value);
              }}
              testID={testID ? `${testID}-${option.value}` : undefined}
              className={`min-h-11 justify-center rounded-md border px-3 py-2 ${selected ? 'border-primary bg-primary' : 'border-input bg-background'}`}
            >
              <Text
                className={`text-sm font-medium ${selected ? 'text-primary-foreground' : 'text-foreground'}`}
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
