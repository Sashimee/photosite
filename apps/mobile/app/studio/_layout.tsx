import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';

import { RequireSession } from '../../src/components/require-session';
import { useAuth } from '../../src/lib/auth-context';

function StudioGate() {
  const { t } = useTranslation();
  const { user } = useAuth();

  if (!user?.roles.includes('photographer')) {
    return (
      <View
        className="flex-1 items-center justify-center gap-2 bg-background p-6"
        testID="studio-unavailable"
      >
        <Text className="text-lg font-semibold text-foreground">
          {t('mobile.studio.unavailable.title')}
        </Text>
        <Text className="text-center text-muted-foreground">
          {t('mobile.studio.unavailable.description')}
        </Text>
      </View>
    );
  }

  return <Stack screenOptions={{ headerShown: false }} />;
}

export default function StudioLayout() {
  return (
    <RequireSession>
      <StudioGate />
    </RequireSession>
  );
}
