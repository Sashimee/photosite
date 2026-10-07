import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';

import { BookingDetailView } from '../../src/components/bookings/booking-detail-view';
import { RequireSession } from '../../src/components/require-session';
import { StudioLoading, StudioMessage } from '../../src/components/studio/studio-frame';
import { useAuth } from '../../src/lib/auth-context';
import { useBooking } from '../../src/lib/use-booking';

function ClientBookingDetail({ id }: { id: string }) {
  const { t } = useTranslation();
  const router = useRouter();
  const { user } = useAuth();
  const { state, reload, replaceBooking } = useBooking(id);

  function body() {
    switch (state.status) {
      case 'loading':
        return <StudioLoading testID="booking-detail-loading" />;
      case 'unauthorized':
        return (
          <StudioMessage
            testID="booking-detail-unauthorized"
            message={t('mobile.bookings.detail.sessionExpired')}
          />
        );
      case 'notFound':
        return (
          <StudioMessage
            testID="booking-detail-not-found"
            message={t('mobile.bookings.detail.notFound')}
          />
        );
      case 'error':
        return (
          <StudioMessage
            testID="booking-detail-error"
            message={t('mobile.bookings.detail.loadFailed')}
            actionLabel={t('mobile.bookings.detail.retry')}
            actionTestID="booking-detail-retry"
            onAction={reload}
          />
        );
      case 'ready':
        return state.booking.clientId === user?.id ? (
          <BookingDetailView
            booking={state.booking}
            viewer="client"
            onBookingChanged={replaceBooking}
          />
        ) : (
          <StudioMessage
            testID="booking-detail-not-found"
            message={t('mobile.bookings.detail.notFound')}
          />
        );
    }
  }

  return (
    <View className="flex-1 bg-background pt-12">
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          if (router.canGoBack()) {
            router.back();
          } else {
            router.replace('/bookings');
          }
        }}
        testID="booking-detail-back"
        className="min-h-11 min-w-11 justify-center self-start px-4"
      >
        <Text className="text-base font-medium text-foreground">
          {t('mobile.bookings.detail.back')}
        </Text>
      </Pressable>
      <Text className="px-6 pb-2 text-2xl font-semibold text-foreground" accessibilityRole="header">
        {t('mobile.bookings.detail.title')}
      </Text>
      {body()}
    </View>
  );
}

export default function ClientBookingDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <RequireSession>
      <ClientBookingDetail id={id} />
    </RequireSession>
  );
}
