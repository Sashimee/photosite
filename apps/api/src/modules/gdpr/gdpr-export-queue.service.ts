import type { OnApplicationShutdown } from '@nestjs/common';
import { Inject, Injectable } from '@nestjs/common';
import { GDPR_EXPORT_QUEUE_NAME, GdprExportJobSchema, type GdprExportJob } from '@photoo/shared';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { APP_CONFIG, type Env } from '../../config/env.js';

const EXPORT_JOB_ATTEMPTS = 3;
const EXPORT_JOB_BACKOFF_DELAY_MS = 5000;

@Injectable()
export class GdprExportQueueService implements OnApplicationShutdown {
  private readonly connection: Redis;
  readonly queue: Queue<GdprExportJob>;

  constructor(@Inject(APP_CONFIG) config: Env) {
    this.connection = new Redis(config.REDIS_URL, {
      maxRetriesPerRequest: null,
      retryStrategy: () => null,
    });
    this.queue = new Queue<GdprExportJob>(GDPR_EXPORT_QUEUE_NAME, { connection: this.connection });
  }

  // `jobId = dataRequestId` (docs/steps/1A.12-gdpr.md "Export job shape
  // carries the id only"): a retry re-adds under the same id and resumes
  // from `status` on the row instead of duplicating the archive build.
  async enqueue(dataRequestId: string): Promise<void> {
    const job = GdprExportJobSchema.parse({ dataRequestId });
    await this.queue.add('gdpr-export', job, {
      jobId: dataRequestId,
      attempts: EXPORT_JOB_ATTEMPTS,
      backoff: { type: 'exponential', delay: EXPORT_JOB_BACKOFF_DELAY_MS },
      removeOnComplete: true,
      removeOnFail: false,
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.queue.close();
    this.connection.disconnect();
  }
}
