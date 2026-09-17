import { NOTIFICATION_CHANNELS, type NotificationChannel, type NotificationType } from './enums.js';

export interface NotificationPreferenceOverride {
  type: string;
  channel: NotificationChannel;
  enabled: boolean;
}

// message_received has no email delivery path at all in the MVP (no digest
// job renders it), unlike a per-user default that a preference row could
// override, so this is a single source of truth every layer must consult.
const UNAVAILABLE_CHANNELS: Partial<Record<NotificationType, ReadonlySet<NotificationChannel>>> = {
  message_received: new Set(['email']),
  verification_approved: new Set(['push']),
  verification_rejected: new Set(['push']),
};

export function isChannelAvailable(type: NotificationType, channel: NotificationChannel): boolean {
  return !UNAVAILABLE_CHANNELS[type]?.has(channel);
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

  return NOTIFICATION_CHANNELS.filter((channel) => {
    if (!isChannelAvailable(type, channel)) return false;
    if (channel === 'in_app') return true;
    return overrides.get(channel) ?? true;
  });
}
