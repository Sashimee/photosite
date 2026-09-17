import type { OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { Inject, Injectable } from '@nestjs/common';
import {
  FILE_SCAN_QUEUE_NAME,
  IMAGE_PROCESS_QUEUE_NAME,
  QUOTE_EXPIRY_QUEUE_NAME,
  UPLOADS_CLEANUP_QUEUE_NAME,
} from '@photoo/shared';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { Logger } from 'nestjs-pino';
import { AuditLogService } from '../common/audit-log.service.js';
import { APP_CONFIG, type Env } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';
import { shutdownWorkers } from './graceful-shutdown.js';
import { createFileScanProcessor } from './processors/file-scan.processor.js';
import { createImageProcessProcessor } from './processors/image-process.processor.js';
import { createQuoteExpiryProcessor } from './processors/quote-expiry.processor.js';
import { createUploadsCleanupProcessor } from './processors/uploads-cleanup.processor.js';

const GRACEFUL_SHUTDOWN_TIMEOUT_MS = 30_000;
const UPLOADS_CLEANUP_SCHEDULER_ID = 'uploads-cleanup';
const QUOTE_EXPIRY_SCHEDULER_ID = 'quote-expiry';

@Injectable()
export class QueueWorkersService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly workers: Worker[] = [];
  private readonly connections: Redis[] = [];
  private readonly queues: Queue[] = [];

  constructor(
    @Inject(APP_CONFIG) private readonly config: Env,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(StorageService) private readonly storage: StorageService,
    @Inject(AuditLogService) private readonly auditLog: AuditLogService,
    @Inject(Logger) private readonly logger: Logger,
  ) {}

  private newConnection(): Redis {
    const connection = new Redis(this.config.REDIS_URL, {
      maxRetriesPerRequest: null,
      retryStrategy: () => null,
    });
    this.connections.push(connection);
    return connection;
  }

  async onApplicationBootstrap(): Promise<void> {
    const imageProcessQueue = new Queue(IMAGE_PROCESS_QUEUE_NAME, {
      connection: this.newConnection(),
    });
    const uploadsCleanupQueue = new Queue(UPLOADS_CLEANUP_QUEUE_NAME, {
      connection: this.newConnection(),
    });
    const quoteExpiryQueue = new Queue(QUOTE_EXPIRY_QUEUE_NAME, {
      connection: this.newConnection(),
    });
    this.queues.push(imageProcessQueue, uploadsCleanupQueue, quoteExpiryQueue);

    // Redis being unreachable at boot must not crash the whole process (the
    // health server still needs to come up and report /ready as down): the
    // scheduler is retried the next time the worker restarts.
    try {
      await uploadsCleanupQueue.upsertJobScheduler(
        UPLOADS_CLEANUP_SCHEDULER_ID,
        { every: this.config.UPLOADS_CLEANUP_INTERVAL_MS },
        { name: 'sweep', data: {} },
      );
    } catch (error) {
      this.logger.warn({ err: error }, 'queue-workers: failed to schedule uploads-cleanup');
    }

    try {
      await quoteExpiryQueue.upsertJobScheduler(
        QUOTE_EXPIRY_SCHEDULER_ID,
        { every: this.config.QUOTE_EXPIRY_INTERVAL_MS },
        { name: 'sweep', data: {} },
      );
    } catch (error) {
      this.logger.warn({ err: error }, 'queue-workers: failed to schedule quote-expiry');
    }

    const fileScanWorker = new Worker(
      FILE_SCAN_QUEUE_NAME,
      createFileScanProcessor({
        prisma: this.prisma,
        storage: this.storage,
        auditLog: this.auditLog,
        imageProcessQueue,
        clamd: {
          host: this.config.CLAMAV_HOST,
          port: this.config.CLAMAV_PORT,
          maxBytes: this.config.CLAMAV_MAX_SCAN_BYTES,
          timeoutMs: this.config.CLAMAV_SCAN_TIMEOUT_MS,
        },
        logger: this.logger,
      }),
      { connection: this.newConnection(), concurrency: this.config.WORKER_CONCURRENCY_FILE_SCAN },
    );

    const imageProcessWorker = new Worker(
      IMAGE_PROCESS_QUEUE_NAME,
      createImageProcessProcessor({
        prisma: this.prisma,
        storage: this.storage,
        maxPixels: this.config.IMAGE_PROCESS_MAX_PIXELS,
        logger: this.logger,
      }),
      {
        connection: this.newConnection(),
        concurrency: this.config.WORKER_CONCURRENCY_IMAGE_PROCESS,
      },
    );

    const uploadsCleanupWorker = new Worker(
      UPLOADS_CLEANUP_QUEUE_NAME,
      createUploadsCleanupProcessor({
        prisma: this.prisma,
        storage: this.storage,
        logger: this.logger,
      }),
      {
        connection: this.newConnection(),
        concurrency: this.config.WORKER_CONCURRENCY_UPLOADS_CLEANUP,
      },
    );

    const quoteExpiryWorker = new Worker(
      QUOTE_EXPIRY_QUEUE_NAME,
      createQuoteExpiryProcessor({
        prisma: this.prisma,
        logger: this.logger,
      }),
      {
        connection: this.newConnection(),
        concurrency: this.config.WORKER_CONCURRENCY_QUOTE_EXPIRY,
      },
    );

    for (const [name, worker] of [
      [FILE_SCAN_QUEUE_NAME, fileScanWorker],
      [IMAGE_PROCESS_QUEUE_NAME, imageProcessWorker],
      [UPLOADS_CLEANUP_QUEUE_NAME, uploadsCleanupWorker],
      [QUOTE_EXPIRY_QUEUE_NAME, quoteExpiryWorker],
    ] as const) {
      worker.on('failed', (job, err) => {
        this.logger.error({ err, jobId: job?.id, queue: name }, 'worker: job failed');
      });
      worker.on('error', (err) => {
        this.logger.error({ err, queue: name }, 'worker: connection error');
      });
      this.workers.push(worker);
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.all(this.queues.map((queue) => queue.close()));
    await shutdownWorkers(this.workers, this.connections, GRACEFUL_SHUTDOWN_TIMEOUT_MS, {
      warn: (payload, message) => {
        this.logger.warn(payload, message);
      },
    });
  }
}
