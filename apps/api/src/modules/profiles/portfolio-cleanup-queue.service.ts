import type { OnApplicationShutdown } from '@nestjs/common';
import { Inject, Injectable } from '@nestjs/common';
import {
  PORTFOLIO_IMAGE_CLEANUP_QUEUE_NAME,
  PortfolioImageCleanupJobSchema,
  type PortfolioImageCleanupJob,
} from '@photoo/shared';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { APP_CONFIG, type Env } from '../../config/env.js';

// Enqueue-only: no worker consumer yet (docs/steps/1A.4-profiles-products.md
// defers it, the same way the `email` queue has no consumer until 1A.7).
@Injectable()
export class PortfolioCleanupQueueService implements OnApplicationShutdown {
  private readonly connection: Redis;
  readonly queue: Queue<PortfolioImageCleanupJob>;

  constructor(@Inject(APP_CONFIG) config: Env) {
    this.connection = new Redis(config.REDIS_URL, {
      maxRetriesPerRequest: null,
      retryStrategy: () => null,
    });
    this.queue = new Queue<PortfolioImageCleanupJob>(PORTFOLIO_IMAGE_CLEANUP_QUEUE_NAME, {
      connection: this.connection,
    });
  }

  async enqueue(job: PortfolioImageCleanupJob): Promise<void> {
    const validated = PortfolioImageCleanupJobSchema.parse(job);
    await this.queue.add('cleanup', validated, {
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
