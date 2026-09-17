import { NOTIFICATION_TEXT_MAX_LENGTH } from './contract/notifications.js';

// Clamps a display value (request title, counterpart name) to
// NotificationPayloadSchema's limit before it reaches validation, so a
// payload with an overlong value gets truncated rather than rejected.
export function truncateNotificationText(
  value: string,
  maxLength = NOTIFICATION_TEXT_MAX_LENGTH,
): string {
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}
