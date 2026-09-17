import { getMessages } from '@photoo/i18n';
import type { NotificationPayload, NotificationType } from '@photoo/shared';
import { formatText } from '../format-message.js';
import { buildNotificationPath } from './notify-email.js';

export interface RenderedPush {
  title: string;
  body: string;
  url: string;
}

// No amounts or message text, just a localised title/body and a deep link
// path (docs/steps/1A.7-notifications.md "Push").
export function renderNotifyPush(
  type: NotificationType,
  payload: NotificationPayload,
  locale: string,
  webAppUrl: string,
): RenderedPush {
  if (!payload.quoteId) {
    throw new Error(`renderNotifyPush: "${type}" payload is missing quoteId`);
  }

  const messages = getMessages(locale);
  const t = messages.push.notifications;
  const templates: Record<NotificationType, { title: string; body: string }> = {
    quote_received: t.quoteReceived,
    quote_accepted: t.quoteAccepted,
    quote_declined: t.quoteDeclined,
    quote_withdrawn: t.quoteWithdrawn,
    quote_expired: t.quoteExpired,
  };
  const template = templates[type];
  const counterpartName =
    payload.counterpartName ?? messages.email.notifications.unknownCounterpart;

  return {
    title: template.title,
    body: formatText(template.body, { counterpartName }),
    url: `${webAppUrl}${buildNotificationPath(locale, payload.quoteId)}`,
  };
}
