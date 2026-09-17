import type { OnApplicationShutdown } from '@nestjs/common';
import { Inject, Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { APP_CONFIG, type Env } from '../../../config/env.js';

export const EMAIL_QUEUE_NAME = 'email';

export type EmailJob =
  | { type: 'verify-email'; to: string; url: string }
  | { type: 'reset-password'; to: string; url: string }
  | { type: 'account-exists'; to: string };

const FAILED_JOB_RETENTION_SECONDS = 24 * 60 * 60;

@Injectable()
export class EmailQueueService implements OnApplicationShutdown {
  private readonly connection: Redis;
  readonly queue: Queue<EmailJob>;

  constructor(@Inject(APP_CONFIG) config: Env) {
    this.connection = new Redis(config.REDIS_URL, {
      maxRetriesPerRequest: null,
      retryStrategy: () => null,
    });
    this.queue = new Queue<EmailJob>(EMAIL_QUEUE_NAME, { connection: this.connection });
  }

  async enqueue(job: EmailJob): Promise<void> {
    // The job payload (including any verification/reset link) is dropped
    // once the mail is sent, and kept only briefly on failure for
    // debugging, so Redis never retains a long-lived copy of the token.
    await this.queue.add(job.type, job, {
      removeOnComplete: true,
      removeOnFail: { age: FAILED_JOB_RETENTION_SECONDS },
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.queue.close();
    this.connection.disconnect();
  }
}
