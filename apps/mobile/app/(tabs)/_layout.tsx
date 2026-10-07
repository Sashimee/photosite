import { Tabs } from 'expo-router/js-tabs';
import { useTranslation } from 'react-i18next';

import { useUnreadCount } from '../../src/lib/use-unread-count';

export default function TabsLayout() {
  const { t } = useTranslation();
  const unreadCount = useUnreadCount();

  return (
    <Tabs>
      <Tabs.Screen name="index" options={{ title: t('mobile.tabs.discover') }} />
      <Tabs.Screen name="requests" options={{ title: t('mobile.tabs.requests') }} />
      <Tabs.Screen
        name="messages"
        options={{
          title: t('mobile.tabs.messages'),
          ...(unreadCount > 0
            ? {
                tabBarBadge: unreadCount,
                tabBarAccessibilityLabel: `${t('mobile.tabs.messages')}, ${t('mobile.chat.list.unreadBadge', { count: unreadCount })}`,
              }
            : {}),
        }}
      />
      <Tabs.Screen
        name="account"
        options={{ title: t('mobile.tabs.account'), tabBarButtonTestID: 'tab-account' }}
      />
    </Tabs>
  );
}
