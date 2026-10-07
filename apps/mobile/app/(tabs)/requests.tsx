import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';

import { PrimaryButton } from '../../src/components/form/primary-button';
import { RequireSession } from '../../src/components/require-session';

export default function RequestsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  return (
    <RequireSession>
      <View className="flex-1 items-center justify-center gap-4 bg-background px-6">
        <Text className="text-xl font-semibold text-foreground">{t('mobile.tabs.requests')}</Text>
        <PrimaryButton
          testID="requests-new"
          label={t('mobile.requests.list.newRequest')}
          onPress={() => {
            router.push('/requests/new');
          }}
        />
      </View>
    </RequireSession>
  );
}
