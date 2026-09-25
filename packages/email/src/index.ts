export { formatHtml, formatText } from './format-message.js';
export { escapeHtml } from './html.js';
export type { MailMessage } from './mail-message.js';
export { renderAuthEmail } from './templates/auth-email.js';
export {
  buildConversationPath,
  buildJobApplicationsPath,
  buildJobOfferApplicationsPath,
  buildModerationNoticePath,
  buildNotificationPath,
  buildVerificationCasePath,
  renderNotifyEmail,
  requireConversationId,
  requireJobOfferId,
  requireModerationOutcome,
  requireQuoteId,
  requireReason,
} from './templates/notify-email.js';
export {
  AUTH_EMAIL_TEMPLATE_NAMES,
  EMAIL_TEMPLATE_NAMES,
  NOTIFY_EMAIL_TEMPLATE_NAMES,
  renderPreview,
  type EmailPreview,
  type EmailTemplateName,
} from './preview.js';
