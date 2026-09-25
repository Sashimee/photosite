import { getMessages } from '@photoo/i18n';
import type { NotificationPayload, NotificationType } from '@photoo/shared';
import { formatHtml, formatText } from '../format-message.js';
import { escapeHtml } from '../html.js';
import type { MailMessage } from '../mail-message.js';

// Links are built only from webAppUrl plus ids, never from user input
// (docs/steps/1A.7-notifications.md).
export function buildNotificationPath(locale: string, quoteId: string): string {
  return `/${locale}/quotes/${quoteId}`;
}

export function buildConversationPath(locale: string, conversationId: string): string {
  return `/${locale}/messages/${conversationId}`;
}

export function buildVerificationCasePath(locale: string): string {
  return `/${locale}/account/verification`;
}

export function buildJobOfferApplicationsPath(locale: string, jobOfferId: string): string {
  return `/${locale}/account/job-offers/${jobOfferId}/applications`;
}

export function buildJobApplicationsPath(locale: string): string {
  return `/${locale}/account/job-applications`;
}

export function buildModerationNoticePath(locale: string): string {
  return `/${locale}/account/notifications`;
}

export function requireModerationOutcome(
  type: NotificationType,
  payload: NotificationPayload,
): NonNullable<NotificationPayload['moderationOutcome']> {
  if (!payload.moderationOutcome) {
    throw new Error(`notify templates: "${type}" payload is missing moderationOutcome`);
  }
  return payload.moderationOutcome;
}

export function requireReason(type: NotificationType, payload: NotificationPayload): string {
  if (!payload.reason) {
    throw new Error(`notify templates: "${type}" payload is missing reason`);
  }
  return payload.reason;
}

export function requireQuoteId(type: NotificationType, payload: NotificationPayload): string {
  if (!payload.quoteId) {
    throw new Error(`notify templates: "${type}" payload is missing quoteId`);
  }
  return payload.quoteId;
}

export function requireJobOfferId(type: NotificationType, payload: NotificationPayload): string {
  if (!payload.jobOfferId) {
    throw new Error(`notify templates: "${type}" payload is missing jobOfferId`);
  }
  return payload.jobOfferId;
}

export function requireConversationId(
  type: NotificationType,
  payload: NotificationPayload,
): string {
  if (!payload.conversationId) {
    throw new Error(`notify templates: "${type}" payload is missing conversationId`);
  }
  return payload.conversationId;
}

// The photographer is never shown the client's raw User.name (S6/compliance:
// it defaults to the client's email local part). For message_received, a
// missing counterpartName always means a client sender, since a
// conversation has exactly two participants and the photographer's name is
// always resolvable from their profile.
const PHOTOGRAPHER_FACING_TYPES: ReadonlySet<NotificationType> = new Set([
  'quote_accepted',
  'quote_declined',
  'message_received',
]);

// Not a real character any template or value contains, so it survives
// formatHtml's escaping untouched and can be swapped for a real <a> tag
// afterwards, without formatHtml treating markup as raw, unescaped input.
// U+0001 rather than a NUL byte: a NUL makes git treat this file as
// binary and diffs unreviewable (#262).
const URL_TOKEN = '\u0001NOTIFY_URL\u0001';

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

function link(url: string): string {
  const escaped = escapeHtml(url);
  return `<a href="${escaped}">${escaped}</a>`;
}

function renderHtmlWithLink(template: string, values: Record<string, string>, url: string): string {
  const withToken = formatHtml(template, { ...values, url: URL_TOKEN });
  return withToken.replaceAll(URL_TOKEN, link(url));
}

// The DSA statement of reasons lives entirely in this notice, unlike
// `verification_rejected`'s deep link back to a sign-in-gated detail page:
// there is no such page for a report's outcome, and the affected party may
// not even be the account holder who filed it.
function renderModerationNoticeEmail(
  type: 'report_decision' | 'moderation_action',
  payload: NotificationPayload,
  locale: string,
  to: string,
  webAppUrl: string,
  messages: ReturnType<typeof getMessages>,
): MailMessage {
  const outcome = requireModerationOutcome(type, payload);
  const reason = requireReason(type, payload);
  const table =
    type === 'report_decision'
      ? messages.email.notifications.reportDecision
      : messages.email.notifications.moderationAction;
  const template = table[outcome];
  const url = `${webAppUrl}${buildModerationNoticePath(locale)}`;
  const preferencesUrl = `${webAppUrl}/${locale}/account/notifications`;
  const values = { reason };

  const bodyText = formatText(template.body, { ...values, url });
  const bodyHtml = renderHtmlWithLink(template.body, values, url);
  const footerText = formatText(messages.email.footer.preferences, { url: preferencesUrl });
  const footerHtml = renderHtmlWithLink(messages.email.footer.preferences, {}, preferencesUrl);

  return {
    to,
    subject: formatText(template.subject, values),
    text: `${bodyText}\n\n${footerText}`,
    html: `<p>${bodyHtml}</p><p>${footerHtml}</p>`,
    headers: { 'List-Unsubscribe': `<${preferencesUrl}>` },
  };
}

export function renderNotifyEmail(
  type: NotificationType,
  payload: NotificationPayload,
  locale: string,
  to: string,
  webAppUrl: string,
): MailMessage {
  const messages = getMessages(locale);
  const t = messages.email.notifications;

  if (type === 'report_decision' || type === 'moderation_action') {
    return renderModerationNoticeEmail(type, payload, locale, to, webAppUrl, messages);
  }

  const templates: Record<
    Exclude<NotificationType, 'report_decision' | 'moderation_action'>,
    { subject: string; body: string }
  > = {
    quote_received: t.quoteReceived,
    quote_accepted: t.quoteAccepted,
    quote_declined: t.quoteDeclined,
    quote_withdrawn: t.quoteWithdrawn,
    quote_expired: t.quoteExpired,
    message_received: t.messageReceived,
    verification_approved: t.verificationApproved,
    verification_rejected: t.verificationRejected,
    job_application_received: t.jobApplicationReceived,
    job_application_status_changed: t.jobApplicationStatusChanged,
  };
  const template = templates[type];

  const path =
    type === 'message_received'
      ? buildConversationPath(locale, requireConversationId(type, payload))
      : type === 'verification_approved' || type === 'verification_rejected'
        ? buildVerificationCasePath(locale)
        : type === 'job_application_received'
          ? buildJobOfferApplicationsPath(locale, requireJobOfferId(type, payload))
          : type === 'job_application_status_changed'
            ? buildJobApplicationsPath(locale)
            : buildNotificationPath(locale, requireQuoteId(type, payload));
  const url = `${webAppUrl}${path}`;
  const preferencesUrl = `${webAppUrl}/${locale}/account/notifications`;
  const fallbackCounterpart = PHOTOGRAPHER_FACING_TYPES.has(type)
    ? t.unknownClient
    : t.unknownCounterpart;
  const values = {
    counterpartName: payload.counterpartName ?? fallbackCounterpart,
    requestTitle: payload.requestTitle ?? t.directQuoteLabel,
    jobOfferTitle: payload.jobOfferTitle ?? t.unknownJobOffer,
    total: moneyLabel(payload.total, locale),
  };

  const bodyText = formatText(template.body, { ...values, url });
  const bodyHtml = renderHtmlWithLink(template.body, values, url);
  const footerText = formatText(messages.email.footer.preferences, { url: preferencesUrl });
  const footerHtml = renderHtmlWithLink(messages.email.footer.preferences, {}, preferencesUrl);

  return {
    to,
    subject: formatText(template.subject, values),
    text: `${bodyText}\n\n${footerText}`,
    html: `<p>${bodyHtml}</p><p>${footerHtml}</p>`,
    headers: { 'List-Unsubscribe': `<${preferencesUrl}>` },
  };
}
