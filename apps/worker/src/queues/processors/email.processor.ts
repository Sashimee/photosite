import { EmailJobSchema, type EmailJob } from '@photoo/shared';
import type { Processor } from 'bullmq';
import type { Logger } from 'nestjs-pino';
import type { MailTransport } from '../../email/mail-transport.js';
import { renderAuthEmail } from '../../email/templates/auth-email.js';

export interface EmailProcessorDeps {
  mailTransport: MailTransport;
  logger: Logger;
}

export function createEmailProcessor(deps: EmailProcessorDeps): Processor<EmailJob> {
  return async (job) => {
    const data = EmailJobSchema.parse(job.data);
    const message = renderAuthEmail(data, data.to);
    await deps.mailTransport.sendMail(message);
  };
}
