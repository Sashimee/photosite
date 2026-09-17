import type { OnApplicationShutdown } from '@nestjs/common';
import { Inject, Injectable } from '@nestjs/common';
import { FILE_SCAN_QUEUE_NAME, FileScanJobSchema, type FileScanJob } from '@photoo/shared';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { APP_CONFIG, type Env } from '../../config/env.js';

@Injectable()
export class FileScanQueueService implements OnApplicationShutdown {
  private readonly connection: Redis;
  readonly queue: Queue<FileScanJob>;

  constructor(@Inject(APP_CONFIG) config: Env) {
    this.connection = new Redis(config.REDIS_URL, {
      maxRetriesPerRequest: null,
      retryStrategy: () => null,
    });
    this.queue = new Queue<FileScanJob>(FILE_SCAN_QUEUE_NAME, { connection: this.connection });
  }

  async enqueue(job: FileScanJob): Promise<void> {
    const validated = FileScanJobSchema.parse(job);
    // "clamd unreachable -> retry with backoff, then failed" (docs/steps/1A.3-uploads.md):
    // the worker's processor only marks the upload failed once this attempt
    // budget is exhausted (see isFinalAttempt in file-scan.processor.ts).
    await this.queue.add('scan', validated, {
      removeOnComplete: true,
      removeOnFail: 100,
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.queue.close();
    this.connection.disconnect();
  }
}
