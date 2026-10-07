import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { BookingDetailView } from '../../../src/components/bookings/booking-detail-view';
import {
  StudioFrame,
  StudioLoading,
  StudioMessage,
} from '../../../src/components/studio/studio-frame';
import { useBooking } from '../../../src/lib/use-booking';
import { useOwnPhotographerProfile } from '../../../src/lib/use-own-photographer-profile';

function StudioBookingDetail({ id }: { id: string }) {
  const { t } = useTranslation();
  const booking = useBooking(id);
  const profile = useOwnPhotographerProfile();

  const notFound = (
    <StudioMessage
      testID="booking-detail-not-found"
      message={t('mobile.studio.bookings.notFound')}
    />
  );

  if (booking.state.status === 'unauthorized' || profile.state.status === 'unauthorized') {
    return (
      <StudioMessage
        testID="booking-detail-unauthorized"
        message={t('mobile.studio.sessionExpired')}
      />
    );
  }
  if (booking.state.status === 'error' || profile.state.status === 'error') {
    return (
      <StudioMessage
        testID="booking-detail-error"
        message={t('mobile.studio.loadFailed')}
        actionLabel={t('mobile.studio.retry')}
        actionTestID="booking-detail-retry"
        onAction={() => {
          if (booking.state.status === 'error') {
            booking.reload();
          }
          if (profile.state.status === 'error') {
            profile.reload();
          }
        }}
      />
    );
  }
  if (booking.state.status === 'notFound' || profile.state.status === 'missing') {
    return notFound;
  }
  if (booking.state.status !== 'ready' || profile.state.status !== 'ready') {
    return <StudioLoading testID="booking-detail-loading" />;
  }
  return booking.state.booking.photographerId === profile.state.profile.id ? (
    <BookingDetailView
      booking={booking.state.booking}
      viewer="photographer"
      onBookingChanged={booking.replaceBooking}
      onDelivered={booking.reload}
    />
  ) : (
    notFound
  );
}

export default function StudioBookingDetailScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();

  return (
    <StudioFrame title={t('mobile.studio.bookings.detailTitle')}>
      <StudioBookingDetail id={id} />
    </StudioFrame>
  );
}
