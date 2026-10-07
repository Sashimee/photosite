import { useTranslation } from 'react-i18next';
import { ScrollView, Text, View } from 'react-native';

import { resolveLocale } from '@photoo/shared';

import type { Booking } from '../../lib/booking-status';
import { formatDateTime } from '../../lib/date-format';
import { formatMoney, requireMoney } from '../../lib/money';
import type { BookingViewer } from '../../lib/use-bookings-list';
import { FormNotice } from '../form/form-notice';
import { BookingAcceptDelivery } from './booking-accept-delivery';
import { BookingDeliveryForm } from './booking-delivery-form';
import { BookingPayPanel } from './booking-pay-panel';
import { BookingStatusTimeline } from './booking-status-timeline';

export function BookingDetailView({
  booking,
  viewer,
  onBookingChanged,
  onDelivered,
}: {
  booking: Booking;
  viewer: BookingViewer;
  onBookingChanged?: (booking: Booking) => void;
  onDelivered?: () => void;
}) {
  const { t, i18n } = useTranslation();
  const locale = resolveLocale(i18n.language);
  const roleScope = viewer === 'client' ? 'mobile.bookings.detail' : 'mobile.studio.bookings';
  const { location } = booking;

  return (
    <ScrollView contentContainerClassName="gap-5 px-6 pb-12" testID="booking-detail">
      <View className="gap-1">
        <Text className="text-sm text-muted-foreground">
          {t('mobile.bookings.detail.totalLabel')}
        </Text>
        <Text className="text-2xl font-semibold text-foreground" testID="booking-total">
          {formatMoney(requireMoney(booking.total, 'booking total'), locale)}
        </Text>
      </View>

      <BookingStatusTimeline status={booking.status} />

      <View className="gap-2">
        <Text className="text-sm text-muted-foreground" testID="booking-schedule">
          {booking.scheduledAt
            ? `${t('mobile.bookings.detail.scheduleLabel')} ${formatDateTime(booking.scheduledAt, locale)}`
            : t('mobile.bookings.detail.notScheduled')}
        </Text>
        <Text className="text-sm text-muted-foreground" testID="booking-location">
          {`${t('mobile.bookings.detail.locationLabel')} ${
            location
              ? t('mobile.bookings.detail.coordinates', {
                  latitude: location.lat,
                  longitude: location.lng,
                })
              : t('mobile.bookings.detail.noLocation')
          }`}
        </Text>
      </View>

      {booking.status === 'pending_payment' && viewer === 'client' && onBookingChanged ? (
        <BookingPayPanel bookingId={booking.id} onBookingChanged={onBookingChanged} />
      ) : null}
      {viewer === 'photographer' && onDelivered ? (
        <BookingDeliveryForm booking={booking} onDelivered={onDelivered} />
      ) : null}
      {viewer === 'client' && onBookingChanged ? (
        <BookingAcceptDelivery booking={booking} onBookingChanged={onBookingChanged} />
      ) : null}
      {booking.status === 'delivered' && booking.releaseDueAt ? (
        <FormNotice tone="info" testID="booking-release-due">
          {t(`${roleScope}.releaseDue`, { date: formatDateTime(booking.releaseDueAt, locale) })}
        </FormNotice>
      ) : null}
      {booking.status === 'disputed' ? (
        <FormNotice tone="info" testID="booking-disputed">
          {t(`${roleScope}.disputed`)}
        </FormNotice>
      ) : null}
    </ScrollView>
  );
}
