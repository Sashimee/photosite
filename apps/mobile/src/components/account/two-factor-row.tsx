import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';

import { useAuth } from '../../lib/auth-context';

export function TwoFactorRow() {
  const { t } = useTranslation();
  const router = useRouter();
  const { user } = useAuth();

  if (!user) {
    return null;
  }
  const enabled = user.twoFactorEnabled;

  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => {
        router.push(enabled ? '/account-security/disable' : '/account-security/enroll');
      }}
      testID="account-two-factor"
      className="mt-3 min-h-11 gap-1 rounded-md border border-border bg-card p-4"
    >
      <View className="flex-row items-center justify-between">
        <Text className="text-base font-semibold text-foreground">
          {t('mobile.account.twoFactor.rowTitle')}
        </Text>
        <Text className="text-sm font-medium text-foreground" testID="account-two-factor-state">
          {enabled ? t('mobile.account.twoFactor.rowOn') : t('mobile.account.twoFactor.rowOff')}
        </Text>
      </View>
      <Text className="text-sm text-muted-foreground">
        {enabled
          ? t('mobile.account.twoFactor.rowHintOn')
          : t('mobile.account.twoFactor.rowHintOff')}
      </Text>
    </Pressable>
  );
}
