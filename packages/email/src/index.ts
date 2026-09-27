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
  requireDecisionReason,
  requireJobOfferId,
  requireModerationOutcome,
  requireProvenanceDecision,
  requireQuoteId,
  requireReason,
} from './templates/notify-email.js';
export { renderPreview, type EmailPreview } from './preview.js';
