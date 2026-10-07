import { useTranslation } from 'react-i18next';

import { BookingsList } from '../../../src/components/bookings/bookings-list';
import {
  StudioFrame,
  StudioLoading,
  StudioMessage,
} from '../../../src/components/studio/studio-frame';
import { useOwnPhotographerProfile } from '../../../src/lib/use-own-photographer-profile';

function StudioBookings() {
  const { t } = useTranslation();
  const { state, reload } = useOwnPhotographerProfile();

  switch (state.status) {
    case 'loading':
      return <StudioLoading testID="bookings-profile-loading" />;
    case 'unauthorized':
      return (
        <StudioMessage testID="bookings-unauthorized" message={t('mobile.studio.sessionExpired')} />
      );
    case 'error':
      return (
        <StudioMessage
          testID="bookings-profile-error"
          message={t('mobile.studio.loadFailed')}
          actionLabel={t('mobile.studio.retry')}
          actionTestID="bookings-profile-retry"
          onAction={reload}
        />
      );
    case 'missing':
      return (
        <StudioMessage
          testID="bookings-empty"
          tone="info"
          message={t('mobile.studio.bookings.empty')}
        />
      );
    case 'ready':
      return <BookingsList viewer="photographer" ownerId={state.profile.id} />;
  }
}

export default function StudioBookingsScreen() {
  const { t } = useTranslation();

  return (
    <StudioFrame title={t('mobile.studio.bookings.title')}>
      <StudioBookings />
    </StudioFrame>
  );
}
