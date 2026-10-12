import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';

import { resolveLocale } from '@photoo/shared';

import { isTerminalBookingStatus, type Booking } from '../../lib/booking-status';
import { formatDateTime } from '../../lib/date-format';
import { formatMoney, requireMoney } from '../../lib/money';
import type { BookingViewer } from '../../lib/use-bookings-list';
import { StatusBadge } from '../requests/status-badge';

export function BookingCard({ booking, viewer }: { booking: Booking; viewer: BookingViewer }) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const locale = resolveLocale(i18n.language);

  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => {
        if (viewer === 'client') {
          router.push({ pathname: '/bookings/[id]', params: { id: booking.id } });
        } else {
          router.push({ pathname: '/studio/bookings/[id]', params: { id: booking.id } });
        }
      }}
      testID={`booking-card-${booking.id}`}
      className="gap-2 rounded-lg border border-border p-4"
    >
      <View className="flex-row items-center justify-between gap-2">
        <StatusBadge
          testID={`booking-card-status-${booking.id}`}
          label={t(`mobile.bookings.status.${booking.status}`)}
          muted={isTerminalBookingStatus(booking.status)}
        />
        <Text className="font-medium text-foreground">
          {formatMoney(requireMoney(booking.total, 'booking total'), locale)}
        </Text>
      </View>
      <Text className="text-sm text-muted-foreground">
        {booking.scheduledAt
          ? `${t('mobile.bookings.detail.scheduleLabel')} ${formatDateTime(booking.scheduledAt, locale)}`
          : t('mobile.bookings.detail.notScheduled')}
      </Text>
    </Pressable>
  );
}
