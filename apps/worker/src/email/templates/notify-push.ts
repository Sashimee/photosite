import { getMessages } from '@photoo/i18n';
import type { NotificationPayload, NotificationType } from '@photoo/shared';
import { formatText } from '../format-message.js';
import {
  buildConversationPath,
  buildNotificationPath,
  buildVerificationCasePath,
  requireConversationId,
  requireQuoteId,
} from './notify-email.js';

export interface RenderedPush {
  title: string;
  body: string;
  url: string;
}

const PHOTOGRAPHER_FACING_TYPES: ReadonlySet<NotificationType> = new Set([
  'quote_accepted',
  'quote_declined',
  'message_received',
]);

// No amounts or message text, just a localised title/body and a deep link
// path, not an absolute URL: the app builds its own base
// (docs/steps/1A.7-notifications.md "Push").
export function renderNotifyPush(
  type: NotificationType,
  payload: NotificationPayload,
  locale: string,
): RenderedPush {
  const messages = getMessages(locale);
  const t = messages.push.notifications;
  const templates: Record<NotificationType, { title: string; body: string }> = {
    quote_received: t.quoteReceived,
    quote_accepted: t.quoteAccepted,
    quote_declined: t.quoteDeclined,
    quote_withdrawn: t.quoteWithdrawn,
    quote_expired: t.quoteExpired,
    message_received: t.messageReceived,
    verification_approved: t.verificationApproved,
    verification_rejected: t.verificationRejected,
  };
  const template = templates[type];
  const fallback = PHOTOGRAPHER_FACING_TYPES.has(type)
    ? messages.email.notifications.unknownClient
    : messages.email.notifications.unknownCounterpart;
  const counterpartName = payload.counterpartName ?? fallback;

  const url =
    type === 'message_received'
      ? buildConversationPath(locale, requireConversationId(type, payload))
      : type === 'verification_approved' || type === 'verification_rejected'
        ? buildVerificationCasePath(locale)
        : buildNotificationPath(locale, requireQuoteId(type, payload));

  return {
    title: template.title,
    body: formatText(template.body, { counterpartName }),
    url,
  };
}
