import { Text, TextInput, View, type TextInputProps } from 'react-native';

interface TextFieldProps extends TextInputProps {
  label: string;
  error?: string | undefined;
  hint?: string | undefined;
}

export function TextField({ label, error, hint, ...inputProps }: TextFieldProps) {
  return (
    <View className="gap-1.5">
      <Text className="text-sm font-medium text-foreground">{label}</Text>
      <TextInput
        className="rounded-md border border-input bg-background px-3 py-2 text-base text-foreground"
        placeholderTextColor="#a3a3a3"
        {...inputProps}
      />
      {hint ? <Text className="text-sm text-muted-foreground">{hint}</Text> : null}
      {error ? <Text className="text-sm text-destructive">{error}</Text> : null}
    </View>
  );
}
