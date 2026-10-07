import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';

import { RequireSession } from '../../src/components/require-session';
import { useAuth } from '../../src/lib/auth-context';

function AccountContent() {
  const { t } = useTranslation();
  const router = useRouter();
  const { user } = useAuth();
  const isPhotographer = user?.roles.includes('photographer') === true;

  return (
    <View className="flex-1 bg-background px-6 pt-12">
      <Text className="pb-4 text-2xl font-semibold text-foreground">
        {t('mobile.tabs.account')}
      </Text>
      {isPhotographer ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            router.push('/studio');
          }}
          testID="account-studio-entry"
          className="min-h-11 gap-1 rounded-md border border-border bg-card p-4"
        >
          <Text className="text-base font-semibold text-foreground">
            {t('mobile.studio.accountEntry')}
          </Text>
          <Text className="text-sm text-muted-foreground">
            {t('mobile.studio.accountEntryHint')}
          </Text>
        </Pressable>
      ) : null}
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          router.push('/consent');
        }}
        testID="account-consent-entry"
        className="mt-3 min-h-11 gap-1 rounded-md border border-border bg-card p-4"
      >
        <Text className="text-base font-semibold text-foreground">
          {t('mobile.consent.settingsEntry')}
        </Text>
        <Text className="text-sm text-muted-foreground">
          {t('mobile.consent.settingsEntryHint')}
        </Text>
      </Pressable>
    </View>
  );
}

export default function AccountScreen() {
  return (
    <RequireSession>
      <AccountContent />
    </RequireSession>
  );
}
