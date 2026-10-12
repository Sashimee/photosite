import { useState, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';

import { PrimaryButton } from '../form/primary-button';

export function ConfirmAction({
  triggerLabel,
  title,
  description,
  confirmLabel,
  pendingLabel,
  dismissLabel,
  pending,
  disabled,
  outline,
  onConfirm,
  testID,
  children,
}: {
  triggerLabel: string;
  title: string;
  description: string;
  confirmLabel: string;
  pendingLabel: string;
  dismissLabel: string;
  pending: boolean;
  disabled?: boolean;
  outline?: boolean;
  onConfirm: () => Promise<void>;
  testID: string;
  children?: ReactNode;
}) {
  const [confirming, setConfirming] = useState(false);

  async function confirm() {
    await onConfirm();
    setConfirming(false);
  }

  if (!confirming) {
    return outline ? (
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: Boolean(disabled) }}
        disabled={disabled}
        onPress={() => {
          setConfirming(true);
        }}
        testID={testID}
        className={`min-h-11 items-center justify-center rounded-md border border-input px-4 py-3 ${disabled ? 'opacity-50' : ''}`}
      >
        <Text className="text-base font-medium text-foreground">{triggerLabel}</Text>
      </Pressable>
    ) : (
      <PrimaryButton
        testID={testID}
        label={triggerLabel}
        disabled={disabled === true}
        onPress={() => {
          setConfirming(true);
        }}
      />
    );
  }

  return (
    <View className="gap-3 rounded-md border border-border bg-muted p-4" testID={`${testID}-panel`}>
      <Text className="text-base font-semibold text-foreground">{title}</Text>
      <Text className="text-sm text-muted-foreground">{description}</Text>
      {children}
      <PrimaryButton
        testID={`${testID}-confirm`}
        label={pending ? pendingLabel : confirmLabel}
        loading={pending}
        onPress={() => void confirm()}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: pending }}
        disabled={pending}
        onPress={() => {
          setConfirming(false);
        }}
        testID={`${testID}-dismiss`}
        className="min-h-11 items-center justify-center"
      >
        <Text className="text-sm font-medium text-foreground underline">{dismissLabel}</Text>
      </Pressable>
    </View>
  );
}
