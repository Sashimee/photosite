import type { OnApplicationShutdown } from '@nestjs/common';
import { Inject, Injectable } from '@nestjs/common';
import { NOTIFY_QUEUE_NAME, NotifyJobSchema, type NotifyJob } from '@photoo/shared';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { APP_CONFIG, type Env } from '../../config/env.js';

const FAILED_JOB_RETENTION_SECONDS = 24 * 60 * 60;

@Injectable()
export class NotifyQueueService implements OnApplicationShutdown {
  private readonly connection: Redis;
  readonly queue: Queue<NotifyJob>;

  constructor(@Inject(APP_CONFIG) config: Env) {
    this.connection = new Redis(config.REDIS_URL, {
      maxRetriesPerRequest: null,
      retryStrategy: () => null,
    });
    this.queue = new Queue<NotifyJob>(NOTIFY_QUEUE_NAME, { connection: this.connection });
  }

  // jobId = notificationId, so a lost-and-retried enqueue (or the worker's
  // notify-sweep) is a no-op against a job already in flight.
  async enqueue(notificationId: string): Promise<void> {
    const job = NotifyJobSchema.parse({ notificationId });
    await this.queue.add('notify', job, {
      jobId: notificationId,
      removeOnComplete: true,
      removeOnFail: { age: FAILED_JOB_RETENTION_SECONDS },
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.queue.close();
    this.connection.disconnect();
  }
}
