import {
  AUTH_EMAIL_TEMPLATE_NAMES,
  type EmailJob,
  type EmailTemplateName,
  type Locale,
  type NotificationPayload,
  type NotificationType,
} from '@photoo/shared';
import { renderAuthEmail } from './templates/auth-email.js';
import { renderNotifyEmail } from './templates/notify-email.js';

export const SAMPLE_RECIPIENT_EMAIL = 'preview@example.test';
export const SAMPLE_WEB_APP_URL = 'https://example.test';

const SAMPLE_VERIFY_URL = 'https://example.test/verify-email?token=preview-token';
const SAMPLE_RESET_URL = 'https://example.test/reset-password?token=preview-token';
const SAMPLE_DELETION_URL = 'https://example.test/account/deletion/cancel?token=preview-token';
const SAMPLE_ACCOUNT_URL = 'https://example.test/account';
const SAMPLE_EXPORT_EXPIRES_AT = '2026-01-08T00:00:00.000Z';

const AUTH_EMAIL_SAMPLE_JOBS: Record<EmailJob['type'], EmailJob> = {
  'verify-email': { type: 'verify-email', to: SAMPLE_RECIPIENT_EMAIL, url: SAMPLE_VERIFY_URL },
  'reset-password': { type: 'reset-password', to: SAMPLE_RECIPIENT_EMAIL, url: SAMPLE_RESET_URL },
  'account-exists': { type: 'account-exists', to: SAMPLE_RECIPIENT_EMAIL },
  'account-deletion-requested': {
    type: 'account-deletion-requested',
    to: SAMPLE_RECIPIENT_EMAIL,
    url: SAMPLE_DELETION_URL,
  },
  'data-export-ready': {
    type: 'data-export-ready',
    to: SAMPLE_RECIPIENT_EMAIL,
    url: SAMPLE_ACCOUNT_URL,
    expiresAt: SAMPLE_EXPORT_EXPIRES_AT,
  },
  'data-export-failed': {
    type: 'data-export-failed',
    to: SAMPLE_RECIPIENT_EMAIL,
    url: SAMPLE_ACCOUNT_URL,
  },
};

const SAMPLE_NOTIFICATION_PAYLOAD: NotificationPayload = {
  quoteId: '00000000-0000-4000-8000-000000000001',
  requestId: '00000000-0000-4000-8000-000000000002',
  requestTitle: 'Wedding photography in Luxembourg City',
  total: { amountCents: 45000, currency: 'EUR' },
  counterpartName: 'Jane Preview',
  conversationId: '00000000-0000-4000-8000-000000000003',
  reason: 'This is a fake sample reason used for email previews only.',
  jobOfferId: '00000000-0000-4000-8000-000000000004',
  jobOfferTitle: 'Second shooter needed for a preview event',
  jobApplicationId: '00000000-0000-4000-8000-000000000005',
  moderationOutcome: 'resolved',
};

const AUTH_EMAIL_TEMPLATE_NAME_SET: ReadonlySet<string> = new Set(AUTH_EMAIL_TEMPLATE_NAMES);

export interface EmailPreview {
  subject: string;
  html: string;
  text: string;
}

export function renderPreview(template: EmailTemplateName, locale: Locale): EmailPreview {
  if (AUTH_EMAIL_TEMPLATE_NAME_SET.has(template)) {
    const job = AUTH_EMAIL_SAMPLE_JOBS[template as EmailJob['type']];
    const message = renderAuthEmail(job, SAMPLE_RECIPIENT_EMAIL);
    return { subject: message.subject, html: message.html, text: message.text };
  }

  const message = renderNotifyEmail(
    template as NotificationType,
    SAMPLE_NOTIFICATION_PAYLOAD,
    locale,
    SAMPLE_RECIPIENT_EMAIL,
    SAMPLE_WEB_APP_URL,
  );
  return { subject: message.subject, html: message.html, text: message.text };
}
