import type { OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { Inject, Injectable } from '@nestjs/common';
import { Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { Logger } from 'nestjs-pino';
import { APP_CONFIG, type Env } from '../config/env.js';
import { shutdownWorkers } from './graceful-shutdown.js';
import { createValidatingProcessor } from './queue-processors.js';
import { WORKER_QUEUE_NAMES, type WorkerQueueName } from './worker-queues.js';

const GRACEFUL_SHUTDOWN_TIMEOUT_MS = 30_000;

const CONCURRENCY_ENV_KEY: Record<WorkerQueueName, keyof Env> = {
  'file-scan': 'WORKER_CONCURRENCY_FILE_SCAN',
  'image-process': 'WORKER_CONCURRENCY_IMAGE_PROCESS',
  'uploads-cleanup': 'WORKER_CONCURRENCY_UPLOADS_CLEANUP',
};

@Injectable()
export class QueueWorkersService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly workers: Worker[] = [];
  private readonly connections: Redis[] = [];

  constructor(
    @Inject(APP_CONFIG) private readonly config: Env,
    @Inject(Logger) private readonly logger: Logger,
  ) {}

  onApplicationBootstrap(): void {
    for (const queueName of WORKER_QUEUE_NAMES) {
      const connection = new Redis(this.config.REDIS_URL, {
        maxRetriesPerRequest: null,
        retryStrategy: () => null,
      });
      const worker = new Worker(queueName, createValidatingProcessor(queueName, this.logger), {
        connection,
        concurrency: this.config[CONCURRENCY_ENV_KEY[queueName]] as number,
      });
      worker.on('failed', (job, err) => {
        this.logger.error({ err, jobId: job?.id, queue: queueName }, 'worker: job failed');
      });
      worker.on('error', (err) => {
        this.logger.error({ err, queue: queueName }, 'worker: connection error');
      });
      this.workers.push(worker);
      this.connections.push(connection);
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await shutdownWorkers(this.workers, this.connections, GRACEFUL_SHUTDOWN_TIMEOUT_MS, {
      warn: (payload, message) => {
        this.logger.warn(payload, message);
      },
    });
  }
}
