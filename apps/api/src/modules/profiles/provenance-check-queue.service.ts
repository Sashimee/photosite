import type { OnApplicationShutdown } from '@nestjs/common';
import { Inject, Injectable } from '@nestjs/common';
import {
  PROVENANCE_CHECK_QUEUE_NAME,
  ProvenanceCheckJobSchema,
  type ProvenanceCheckJob,
} from '@photoo/shared';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { APP_CONFIG, type Env } from '../../config/env.js';

@Injectable()
export class ProvenanceCheckQueueService implements OnApplicationShutdown {
  private readonly connection: Redis;
  readonly queue: Queue<ProvenanceCheckJob>;

  constructor(@Inject(APP_CONFIG) config: Env) {
    this.connection = new Redis(config.REDIS_URL, {
      maxRetriesPerRequest: null,
      retryStrategy: () => null,
    });
    this.queue = new Queue<ProvenanceCheckJob>(PROVENANCE_CHECK_QUEUE_NAME, {
      connection: this.connection,
    });
  }

  // `jobId = portfolioImageId` so an admin recheck re-adds under the same
  // id; with `removeOnComplete: true` the id is freed once the prior run
  // finishes, so the re-add is never blocked by a stale terminal job.
  async enqueue(job: ProvenanceCheckJob): Promise<void> {
    const validated = ProvenanceCheckJobSchema.parse(job);
    await this.queue.add('provenance-check', validated, {
      jobId: validated.portfolioImageId,
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
