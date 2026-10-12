import type { OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { Inject, Injectable } from '@nestjs/common';
import { BOOKING_RELEASE_QUEUE_NAME, BookingReleaseJobSchema } from '@photoo/shared';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { Logger } from 'nestjs-pino';
import { APP_CONFIG, type Env } from '../../config/env.js';
import { BookingReleaseService } from './booking-release.service.js';

const BOOKING_RELEASE_SCHEDULER_ID = 'booking-release';

// Runs in the API rather than apps/worker because creating a Transfer needs
// the Stripe gateway, which only the API holds. BullMQ's job scheduler keeps
// one sweep per interval across API replicas; the per-booking money lock in
// BookingReleaseService covers an overlap with accept-delivery or a refund.
@Injectable()
export class BookingReleaseQueueService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly connections: Redis[] = [];
  private queue: Queue | undefined;
  private worker: Worker | undefined;

  constructor(
    @Inject(APP_CONFIG) private readonly env: Env,
    @Inject(BookingReleaseService) private readonly release: BookingReleaseService,
    @Inject(Logger) private readonly logger: Logger,
  ) {}

  private newConnection(): Redis {
    const connection = new Redis(this.env.REDIS_URL, {
      maxRetriesPerRequest: null,
      retryStrategy: () => null,
    });
    this.connections.push(connection);
    return connection;
  }

  async onApplicationBootstrap(): Promise<void> {
    const interval = this.env.BOOKING_RELEASE_INTERVAL_MS;
    if (interval === 0) {
      return;
    }
    this.queue = new Queue(BOOKING_RELEASE_QUEUE_NAME, { connection: this.newConnection() });
    this.worker = new Worker(
      BOOKING_RELEASE_QUEUE_NAME,
      async (job) => {
        BookingReleaseJobSchema.parse(job.data);
        return this.release.sweep();
      },
      { connection: this.newConnection(), concurrency: 1 },
    );
    this.worker.on('failed', (job, error) => {
      this.logger.error({ jobId: job?.id, err: error }, 'booking release: job failed');
    });
    this.worker.on('error', (error) => {
      this.logger.error({ err: error }, 'booking release: queue connection error');
    });
    // Redis being down at boot must not stop the API from serving; the
    // scheduler is upserted again on the next start.
    try {
      await this.queue.upsertJobScheduler(
        BOOKING_RELEASE_SCHEDULER_ID,
        { every: interval },
        { name: 'sweep', data: {} },
      );
    } catch (error) {
      this.logger.warn({ err: error }, 'booking release: could not schedule the release job');
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
    for (const connection of this.connections) {
      connection.disconnect();
    }
  }
}
