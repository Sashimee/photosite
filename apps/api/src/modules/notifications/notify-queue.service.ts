import type { OnApplicationShutdown } from '@nestjs/common';
import { Inject, Injectable } from '@nestjs/common';
import {
  NOTIFY_QUEUE_NAME,
  NotifyJobSchema,
  notifyJobOptions,
  type NotifyJob,
} from '@photoo/shared';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { APP_CONFIG, type Env } from '../../config/env.js';

@Injectable()
export class NotifyQueueService implements OnApplicationShutdown {
  private readonly connection: Redis;
  readonly queue: Queue<NotifyJob>;

  constructor(@Inject(APP_CONFIG) config: Env) {
    // Other BullMQ connections in this codebase use
    // `retryStrategy: () => null` (give up permanently); this one recovers
    // after a Redis blip instead of blocking every future enqueue.
    this.connection = new Redis(config.REDIS_URL, {
      maxRetriesPerRequest: null,
      retryStrategy: (times) => Math.min(times * 200, 5000),
    });
    this.queue = new Queue<NotifyJob>(NOTIFY_QUEUE_NAME, { connection: this.connection });
  }

  async enqueue(notificationId: string): Promise<void> {
    const job = NotifyJobSchema.parse({ notificationId });
    await this.queue.add('notify', job, notifyJobOptions(notificationId));
  }

  async onApplicationShutdown(): Promise<void> {
    await this.queue.close();
    this.connection.disconnect();
  }
}
