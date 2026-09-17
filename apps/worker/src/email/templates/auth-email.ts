import { DEFAULT_LOCALE, getMessages } from '@photoo/i18n';
import type { EmailJob } from '@photoo/shared';
import { formatHtml, formatText } from '../format-message.js';
import type { MailMessage } from '../mail-transport.js';

// The auth jobs (verify-email, reset-password, account-exists) carry no
// locale (queues.ts: "an existing exception, because the user may not exist
// yet"), so these always render in the platform default until that changes.
export function renderAuthEmail(job: EmailJob, to: string): MailMessage {
  const messages = getMessages(DEFAULT_LOCALE);
  const t = messages.email;
  const appName = messages.common.appName;

  switch (job.type) {
    case 'verify-email':
      return {
        to,
        subject: formatText(t.verifyEmail.subject, { appName }),
        text: formatText(t.verifyEmail.body, { url: job.url }),
        html: `<p>${formatHtml(t.verifyEmail.body, { url: job.url })}</p>`,
      };
    case 'reset-password':
      return {
        to,
        subject: formatText(t.resetPassword.subject, { appName }),
        text: formatText(t.resetPassword.body, { url: job.url }),
        html: `<p>${formatHtml(t.resetPassword.body, { url: job.url })}</p>`,
      };
    case 'account-exists':
      return {
        to,
        subject: formatText(t.accountExists.subject, { appName }),
        text: formatText(t.accountExists.body, { appName }),
        html: `<p>${formatHtml(t.accountExists.body, { appName })}</p>`,
      };
  }
}
