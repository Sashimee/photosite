import { Tabs } from 'expo-router/js-tabs';
import { useTranslation } from 'react-i18next';

export default function TabsLayout() {
  const { t } = useTranslation();

  return (
    <Tabs>
      <Tabs.Screen name="index" options={{ title: t('mobile.tabs.discover') }} />
      <Tabs.Screen name="requests" options={{ title: t('mobile.tabs.requests') }} />
      <Tabs.Screen name="messages" options={{ title: t('mobile.tabs.messages') }} />
      <Tabs.Screen name="account" options={{ title: t('mobile.tabs.account') }} />
    </Tabs>
  );
}
