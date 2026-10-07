import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';

import {
  BOOKING_MAIN_STEPS,
  BOOKING_SIDE_EXITS,
  type BookingStatus,
} from '../../lib/booking-status';

export function BookingStatusTimeline({ status }: { status: BookingStatus }) {
  const { t } = useTranslation();
  const exited = BOOKING_SIDE_EXITS.includes(status);
  const currentIndex = BOOKING_MAIN_STEPS.indexOf(status);

  return (
    <View
      className="gap-2"
      testID="booking-timeline"
      accessibilityLabel={t('mobile.bookings.detail.timelineLabel')}
    >
      {BOOKING_MAIN_STEPS.map((step, index) => {
        const current = !exited && index === currentIndex;
        const done = !exited && index < currentIndex;
        const stateClass = exited
          ? 'text-muted-foreground line-through'
          : current
            ? 'font-semibold text-foreground'
            : done
              ? 'text-foreground'
              : 'text-muted-foreground';
        return (
          <View
            key={step}
            testID={`booking-timeline-step-${step}`}
            accessibilityState={{ selected: current }}
            className="flex-row items-center gap-3"
          >
            <View
              className={`h-3 w-3 rounded-full border ${current || done ? 'border-foreground bg-foreground' : 'border-border'}`}
            />
            <Text className={`text-sm ${stateClass}`}>{t(`mobile.bookings.status.${step}`)}</Text>
          </View>
        );
      })}
      {exited ? (
        <Text className="text-sm font-medium text-foreground" testID="booking-timeline-exit">
          {`${t('mobile.bookings.detail.timelineExited')} ${t(`mobile.bookings.status.${status}`)}`}
        </Text>
      ) : null}
    </View>
  );
}
