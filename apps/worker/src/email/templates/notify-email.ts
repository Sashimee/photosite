import { getMessages } from '@photoo/i18n';
import type { NotificationPayload, NotificationType } from '@photoo/shared';
import { formatHtml, formatText } from '../format-message.js';
import type { MailMessage } from '../mail-transport.js';

// Links are built only from webAppUrl plus ids, never from user input
// (docs/steps/1A.7-notifications.md).
export function buildNotificationPath(locale: string, quoteId: string): string {
  return `/${locale}/quotes/${quoteId}`;
}

function moneyLabel(
  money: { amountCents: number; currency: string } | undefined,
  locale: string,
): string {
  if (!money) {
    return '';
  }
  return new Intl.NumberFormat(locale, { style: 'currency', currency: money.currency }).format(
    money.amountCents / 100,
  );
}

export function renderNotifyEmail(
  type: NotificationType,
  payload: NotificationPayload,
  locale: string,
  to: string,
  webAppUrl: string,
): MailMessage {
  if (!payload.quoteId) {
    throw new Error(`renderNotifyEmail: "${type}" payload is missing quoteId`);
  }

  const messages = getMessages(locale);
  const t = messages.email.notifications;
  const templates: Record<NotificationType, { subject: string; body: string }> = {
    quote_received: t.quoteReceived,
    quote_accepted: t.quoteAccepted,
    quote_declined: t.quoteDeclined,
    quote_withdrawn: t.quoteWithdrawn,
    quote_expired: t.quoteExpired,
  };
  const template = templates[type];

  const url = `${webAppUrl}${buildNotificationPath(locale, payload.quoteId)}`;
  const preferencesUrl = `${webAppUrl}/${locale}/account/notifications`;
  const values = {
    counterpartName: payload.counterpartName ?? t.unknownCounterpart,
    requestTitle: payload.requestTitle ?? t.directQuoteLabel,
    total: moneyLabel(payload.total, locale),
    url,
  };

  const bodyText = formatText(template.body, values);
  const bodyHtml = formatHtml(template.body, values);
  const footerText = formatText(messages.email.footer.preferences, { url: preferencesUrl });
  const footerHtml = formatHtml(messages.email.footer.preferences, { url: preferencesUrl });

  return {
    to,
    subject: formatText(template.subject, values),
    text: `${bodyText}\n\n${footerText}`,
    html: `<p>${bodyHtml}</p><p>${footerHtml}</p>`,
    headers: { 'List-Unsubscribe': `<${preferencesUrl}>` },
  };
}
