import { NOTIFICATION_CHANNELS, type NotificationChannel, type NotificationType } from './enums.js';

export interface NotificationPreferenceOverride {
  type: string;
  channel: NotificationChannel;
  enabled: boolean;
}

// A missing preference row means the channel defaults to on (DATA-MODEL.md);
// `in_app` can never be disabled, regardless of what is stored. Shared by
// the API (NotificationsService.notify) and the worker (the quote-expiry
// job's quote_expired notifications), so the two never drift.
export function resolveNotificationChannels(
  type: NotificationType,
  preferences: readonly NotificationPreferenceOverride[],
): NotificationChannel[] {
  const overrides = new Map(
    preferences.filter((preference) => preference.type === type).map((p) => [p.channel, p.enabled]),
  );

  return NOTIFICATION_CHANNELS.filter(
    (channel) => channel === 'in_app' || (overrides.get(channel) ?? true),
  );
}
