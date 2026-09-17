import type { OnApplicationShutdown } from '@nestjs/common';
import { Inject, Injectable } from '@nestjs/common';
import { EMAIL_QUEUE_NAME, EmailJobSchema, type EmailJob } from '@photoo/shared';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { APP_CONFIG, type Env } from '../../../config/env.js';

export { EMAIL_QUEUE_NAME, type EmailJob };

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
    const validated = EmailJobSchema.parse(job);
    // The job payload (including any verification/reset link) is dropped
    // once the mail is sent, and kept only briefly on failure for
    // debugging, so Redis never retains a long-lived copy of the token.
    await this.queue.add(validated.type, validated, {
      removeOnComplete: true,
      removeOnFail: { age: FAILED_JOB_RETENTION_SECONDS },
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.queue.close();
    this.connection.disconnect();
  }
}
