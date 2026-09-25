import { DEFAULT_LOCALE, getMessages } from '@photoo/i18n';
import type { EmailJob } from '@photoo/shared';
import { formatHtml, formatText } from '../format-message.js';
import { escapeHtml } from '../html.js';
import type { MailMessage } from '../mail-message.js';

// Not a real character any auth email url contains, so it survives
// formatHtml's escaping untouched and can be swapped for a real <a> tag
// afterwards, without formatHtml treating markup as raw, unescaped input.
// U+0001 rather than a NUL byte: a NUL makes git treat this file as
// binary and diffs unreviewable (#262).
const URL_TOKEN = '\u0001AUTH_URL\u0001';

function link(url: string): string {
  const escaped = escapeHtml(url);
  return `<a href="${escaped}">${escaped}</a>`;
}

function renderHtmlWithLink(template: string, url: string): string {
  return formatHtml(template, { url: URL_TOKEN }).replaceAll(URL_TOKEN, link(url));
}

// The auth jobs (verify-email, reset-password, account-exists,
// account-deletion-requested) carry no locale (queues.ts: "an existing
// exception, because the user may not exist yet"), so these always render
// in the platform default until that changes.
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
        html: `<p>${renderHtmlWithLink(t.verifyEmail.body, job.url)}</p>`,
      };
    case 'reset-password':
      return {
        to,
        subject: formatText(t.resetPassword.subject, { appName }),
        text: formatText(t.resetPassword.body, { url: job.url }),
        html: `<p>${renderHtmlWithLink(t.resetPassword.body, job.url)}</p>`,
      };
    case 'account-exists':
      return {
        to,
        subject: formatText(t.accountExists.subject, { appName }),
        text: formatText(t.accountExists.body, { appName }),
        html: `<p>${formatHtml(t.accountExists.body, { appName })}</p>`,
      };
    case 'account-deletion-requested':
      return {
        to,
        subject: formatText(t.accountDeletionRequested.subject, { appName }),
        text: formatText(t.accountDeletionRequested.body, { url: job.url }),
        html: `<p>${renderHtmlWithLink(t.accountDeletionRequested.body, job.url)}</p>`,
      };
  }
}
