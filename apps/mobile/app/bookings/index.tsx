import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';

import { BookingsList } from '../../src/components/bookings/bookings-list';
import { RequireSession } from '../../src/components/require-session';
import { useAuth } from '../../src/lib/auth-context';

function ClientBookings() {
  const { t } = useTranslation();
  const { user } = useAuth();

  return (
    <View className="flex-1 bg-background pt-12">
      <Text className="px-6 pb-4 text-2xl font-semibold text-foreground" accessibilityRole="header">
        {t('mobile.bookings.list.title')}
      </Text>
      <BookingsList viewer="client" ownerId={user?.id ?? null} />
    </View>
  );
}

export default function BookingsScreen() {
  return (
    <RequireSession>
      <ClientBookings />
    </RequireSession>
  );
}
