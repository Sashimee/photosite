import type { OnApplicationShutdown } from '@nestjs/common';
import { Worker } from 'bullmq';
import { Redis } from 'ioredis';
import type { Logger } from 'nestjs-pino';
import nodemailer from 'nodemailer';
import type { Env } from '../../../config/env.js';
import { EMAIL_QUEUE_NAME, type EmailJob } from './email-queue.service.js';

function subjectFor(job: EmailJob): string {
  switch (job.type) {
    case 'verify-email':
      return 'Verify your photoo.lu email';
    case 'reset-password':
      return 'Reset your photoo.lu password';
    case 'account-exists':
      return 'Someone tried to sign up with your photoo.lu email';
  }
}

function bodyFor(job: EmailJob): { text: string; html: string } {
  if (job.type === 'account-exists') {
    const text =
      'Someone tried to create a photoo.lu account with this email address. If that was you, sign in instead; if not, you can ignore this message.';
    return { text, html: `<p>${text}</p>` };
  }
  return { text: job.url, html: `<p><a href="${job.url}">${job.url}</a></p>` };
}

// 1A.7 replaces this with the real worker app. Until then, this dev-only
// consumer sends queued auth emails through the local Mailpit SMTP server so
// sign-up/reset flows are testable end to end. It must never run outside
// development/test, hence the hard throw below rather than a silent no-op.
export class DevMailWorker implements OnApplicationShutdown {
  private readonly connection: Redis;
  private readonly worker: Worker<EmailJob>;

  constructor(config: Env, logger: Logger) {
    if (config.NODE_ENV === 'production') {
      throw new Error('DevMailWorker must never be constructed with NODE_ENV=production');
    }
    this.connection = new Redis(config.REDIS_URL, {
      maxRetriesPerRequest: null,
      retryStrategy: () => null,
    });
    const transport = nodemailer.createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: false,
    });
    this.worker = new Worker<EmailJob>(
      EMAIL_QUEUE_NAME,
      async (job) => {
        const { text, html } = bodyFor(job.data);
        await transport.sendMail({
          from: config.SMTP_FROM,
          to: job.data.to,
          subject: subjectFor(job.data),
          text,
          html,
        });
      },
      { connection: this.connection },
    );
    this.worker.on('failed', (job, err) => {
      logger.error({ err, jobId: job?.id }, 'dev mail worker: job failed');
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker.close();
    this.connection.disconnect();
  }
}
