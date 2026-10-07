import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { Platform, Pressable, Text, View } from 'react-native';

export function DateTimeField({
  label,
  value,
  onChange,
  minimumDate,
  locale,
  error,
  placeholder,
  testID,
}: {
  label: string;
  value: Date | null;
  onChange: (value: Date) => void;
  minimumDate: Date;
  locale: string;
  error?: string | undefined;
  placeholder: string;
  testID?: string;
}) {
  const display = value
    ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(value)
    : placeholder;

  // Android has no combined date-time picker: pick the date, then the time.
  function openAndroid() {
    const current = value ?? minimumDate;
    DateTimePickerAndroid.open({
      value: current,
      mode: 'date',
      minimumDate,
      onValueChange: (_event, pickedDate) => {
        DateTimePickerAndroid.open({
          value: pickedDate,
          mode: 'time',
          onValueChange: (_timeEvent, pickedTime) => {
            onChange(pickedTime);
          },
        });
      },
    });
  }

  return (
    <View className="gap-1.5" testID={testID}>
      <Text className="text-sm font-medium text-foreground">{label}</Text>
      {Platform.OS === 'android' ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={label}
          onPress={openAndroid}
          testID={testID ? `${testID}-open` : undefined}
          className="min-h-11 justify-center rounded-md border border-input bg-background px-3 py-2"
        >
          <Text className="text-base text-foreground">{display}</Text>
        </Pressable>
      ) : (
        <View className="items-start">
          <DateTimePicker
            value={value ?? minimumDate}
            mode="datetime"
            display="compact"
            minimumDate={minimumDate}
            locale={locale}
            onValueChange={(_event, picked) => {
              onChange(picked);
            }}
            accessibilityLabel={label}
          />
        </View>
      )}
      {error ? <Text className="text-sm text-destructive">{error}</Text> : null}
    </View>
  );
}
