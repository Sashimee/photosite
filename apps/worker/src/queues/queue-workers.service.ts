import type { OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { Inject, Injectable } from '@nestjs/common';
import {
  EMAIL_QUEUE_NAME,
  FILE_SCAN_QUEUE_NAME,
  GDPR_EXPORT_QUEUE_NAME,
  GDPR_SWEEP_QUEUE_NAME,
  IMAGE_PROCESS_QUEUE_NAME,
  LISTING_EXPIRY_QUEUE_NAME,
  NOTIFICATIONS_CLEANUP_QUEUE_NAME,
  NOTIFY_QUEUE_NAME,
  NOTIFY_SWEEP_QUEUE_NAME,
  PUSH_RECEIPTS_QUEUE_NAME,
  QUOTE_EXPIRY_QUEUE_NAME,
  UPLOADS_CLEANUP_QUEUE_NAME,
} from '@photoo/shared';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { Logger } from 'nestjs-pino';
import { AuditLogService } from '../common/audit-log.service.js';
import { reportJobFailure } from '../common/monitoring/report-job-failure.js';
import { APP_CONFIG, type Env } from '../config/env.js';
import { createMailTransport } from '../email/mail-transport.js';
import { createGdprExportProcessor } from '../gdpr/gdpr-export.processor.js';
import { createGdprSweepProcessor } from '../gdpr/gdpr-sweep.processor.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { createExpoPushSender } from '../push/push-sender.js';
import { createRedisPushTicketStore } from '../push/push-ticket-store.js';
import { StorageService } from '../storage/storage.service.js';
import { shutdownWorkers } from './graceful-shutdown.js';
import { createEmailProcessor } from './processors/email.processor.js';
import { createFileScanProcessor } from './processors/file-scan.processor.js';
import { createImageProcessProcessor } from './processors/image-process.processor.js';
import { createListingExpiryProcessor } from './processors/listing-expiry.processor.js';
import { createNotificationsCleanupProcessor } from './processors/notifications-cleanup.processor.js';
import { createNotifyProcessor } from './processors/notify.processor.js';
import { createNotifySweepProcessor } from './processors/notify-sweep.processor.js';
import { createPushReceiptsProcessor } from './processors/push-receipts.processor.js';
import { createQuoteExpiryProcessor } from './processors/quote-expiry.processor.js';
import { createUploadsCleanupProcessor } from './processors/uploads-cleanup.processor.js';

const GRACEFUL_SHUTDOWN_TIMEOUT_MS = 30_000;
const UPLOADS_CLEANUP_SCHEDULER_ID = 'uploads-cleanup';
const QUOTE_EXPIRY_SCHEDULER_ID = 'quote-expiry';
const LISTING_EXPIRY_SCHEDULER_ID = 'listing-expiry';
const NOTIFY_SWEEP_SCHEDULER_ID = 'notify-sweep';
const PUSH_RECEIPTS_SCHEDULER_ID = 'push-receipts';
const NOTIFICATIONS_CLEANUP_SCHEDULER_ID = 'notifications-cleanup';
const GDPR_SWEEP_SCHEDULER_ID = 'gdpr-sweep';

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

  // notifyQueue's producer connection must reconnect after a Redis blip
  // instead of giving up permanently, or enqueues silently stop working
  // until the process restarts. Other queues share the give-up-once
  // strategy, a known wider issue tracked separately.
  private newRecoveringConnection(): Redis {
    const connection = new Redis(this.config.REDIS_URL, {
      maxRetriesPerRequest: null,
      retryStrategy: (times) => Math.min(times * 200, 5000),
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
    const listingExpiryQueue = new Queue(LISTING_EXPIRY_QUEUE_NAME, {
      connection: this.newConnection(),
    });
    const notifyQueue = new Queue(NOTIFY_QUEUE_NAME, {
      connection: this.newRecoveringConnection(),
    });
    const notifySweepQueue = new Queue(NOTIFY_SWEEP_QUEUE_NAME, {
      connection: this.newConnection(),
    });
    const pushReceiptsQueue = new Queue(PUSH_RECEIPTS_QUEUE_NAME, {
      connection: this.newConnection(),
    });
    const notificationsCleanupQueue = new Queue(NOTIFICATIONS_CLEANUP_QUEUE_NAME, {
      connection: this.newConnection(),
    });
    const gdprExportQueue = new Queue(GDPR_EXPORT_QUEUE_NAME, {
      connection: this.newConnection(),
    });
    const gdprSweepQueue = new Queue(GDPR_SWEEP_QUEUE_NAME, {
      connection: this.newConnection(),
    });
    const emailQueue = new Queue(EMAIL_QUEUE_NAME, {
      connection: this.newConnection(),
    });
    this.queues.push(
      imageProcessQueue,
      uploadsCleanupQueue,
      quoteExpiryQueue,
      listingExpiryQueue,
      notifyQueue,
      notifySweepQueue,
      pushReceiptsQueue,
      notificationsCleanupQueue,
      gdprExportQueue,
      gdprSweepQueue,
      emailQueue,
    );

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

    try {
      await listingExpiryQueue.upsertJobScheduler(
        LISTING_EXPIRY_SCHEDULER_ID,
        { every: this.config.LISTING_EXPIRY_INTERVAL_MS },
        { name: 'sweep', data: {} },
      );
    } catch (error) {
      this.logger.warn({ err: error }, 'queue-workers: failed to schedule listing-expiry');
    }

    try {
      await notifySweepQueue.upsertJobScheduler(
        NOTIFY_SWEEP_SCHEDULER_ID,
        { every: this.config.NOTIFY_SWEEP_INTERVAL_MS },
        { name: 'sweep', data: {} },
      );
    } catch (error) {
      this.logger.warn({ err: error }, 'queue-workers: failed to schedule notify-sweep');
    }

    try {
      await pushReceiptsQueue.upsertJobScheduler(
        PUSH_RECEIPTS_SCHEDULER_ID,
        { every: this.config.PUSH_RECEIPTS_INTERVAL_MS },
        { name: 'sweep', data: {} },
      );
    } catch (error) {
      this.logger.warn({ err: error }, 'queue-workers: failed to schedule push-receipts');
    }

    try {
      await notificationsCleanupQueue.upsertJobScheduler(
        NOTIFICATIONS_CLEANUP_SCHEDULER_ID,
        { every: this.config.NOTIFICATIONS_CLEANUP_INTERVAL_MS },
        { name: 'sweep', data: {} },
      );
    } catch (error) {
      this.logger.warn({ err: error }, 'queue-workers: failed to schedule notifications-cleanup');
    }

    try {
      await gdprSweepQueue.upsertJobScheduler(
        GDPR_SWEEP_SCHEDULER_ID,
        { every: this.config.GDPR_SWEEP_INTERVAL_MS },
        { name: 'sweep', data: {} },
      );
    } catch (error) {
      this.logger.warn({ err: error }, 'queue-workers: failed to schedule gdpr-sweep');
    }

    if (this.config.NODE_ENV === 'production' && !this.config.EXPO_ACCESS_TOKEN) {
      this.logger.warn(
        'queue-workers: EXPO_ACCESS_TOKEN is not set in production; push notifications will use the unauthenticated Expo rate limit',
      );
    }
    if (this.config.SMTP_INSECURE_INTERNAL_RELAY) {
      this.logger.warn(
        'queue-workers: SMTP_INSECURE_INTERNAL_RELAY is set; TLS enforcement for the SMTP relay is disabled',
      );
    }

    const mailTransport = createMailTransport(this.config);
    const pushSender = createExpoPushSender(this.config.EXPO_ACCESS_TOKEN);
    const pushTicketStore = createRedisPushTicketStore(this.newConnection());

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
        notifyQueue,
        logger: this.logger,
      }),
      {
        connection: this.newConnection(),
        concurrency: this.config.WORKER_CONCURRENCY_QUOTE_EXPIRY,
      },
    );

    const listingExpiryWorker = new Worker(
      LISTING_EXPIRY_QUEUE_NAME,
      createListingExpiryProcessor({ prisma: this.prisma, logger: this.logger }),
      {
        connection: this.newConnection(),
        concurrency: this.config.WORKER_CONCURRENCY_LISTING_EXPIRY,
      },
    );

    const emailWorker = new Worker(
      EMAIL_QUEUE_NAME,
      createEmailProcessor({ mailTransport, logger: this.logger }),
      { connection: this.newConnection(), concurrency: this.config.WORKER_CONCURRENCY_EMAIL },
    );

    const notifyWorker = new Worker(
      NOTIFY_QUEUE_NAME,
      createNotifyProcessor({
        prisma: this.prisma,
        mailTransport,
        pushSender,
        pushTicketStore,
        webAppUrl: this.config.WEB_APP_URL,
        logger: this.logger,
      }),
      { connection: this.newConnection(), concurrency: this.config.WORKER_CONCURRENCY_NOTIFY },
    );

    const notifySweepWorker = new Worker(
      NOTIFY_SWEEP_QUEUE_NAME,
      createNotifySweepProcessor({ prisma: this.prisma, notifyQueue, logger: this.logger }),
      {
        connection: this.newConnection(),
        concurrency: this.config.WORKER_CONCURRENCY_NOTIFY_SWEEP,
      },
    );

    const pushReceiptsWorker = new Worker(
      PUSH_RECEIPTS_QUEUE_NAME,
      createPushReceiptsProcessor({
        prisma: this.prisma,
        pushSender,
        pushTicketStore,
        logger: this.logger,
      }),
      {
        connection: this.newConnection(),
        concurrency: this.config.WORKER_CONCURRENCY_PUSH_RECEIPTS,
      },
    );

    const notificationsCleanupWorker = new Worker(
      NOTIFICATIONS_CLEANUP_QUEUE_NAME,
      createNotificationsCleanupProcessor({ prisma: this.prisma, logger: this.logger }),
      {
        connection: this.newConnection(),
        concurrency: this.config.WORKER_CONCURRENCY_NOTIFICATIONS_CLEANUP,
      },
    );

    const gdprExportWorker = new Worker(
      GDPR_EXPORT_QUEUE_NAME,
      createGdprExportProcessor({
        prisma: this.prisma,
        storage: this.storage,
        auditLog: this.auditLog,
        logger: this.logger,
        emailQueue,
        webAppUrl: this.config.WEB_APP_URL,
      }),
      {
        connection: this.newConnection(),
        concurrency: this.config.WORKER_CONCURRENCY_GDPR_EXPORT,
      },
    );

    const gdprSweepWorker = new Worker(
      GDPR_SWEEP_QUEUE_NAME,
      createGdprSweepProcessor({
        prisma: this.prisma,
        storage: this.storage,
        auditLog: this.auditLog,
        logger: this.logger,
        monitorSlug: GDPR_SWEEP_SCHEDULER_ID,
        monitorIntervalMs: this.config.GDPR_SWEEP_INTERVAL_MS,
      }),
      {
        connection: this.newConnection(),
        concurrency: this.config.WORKER_CONCURRENCY_GDPR_SWEEP,
      },
    );

    for (const [name, worker] of [
      [FILE_SCAN_QUEUE_NAME, fileScanWorker],
      [IMAGE_PROCESS_QUEUE_NAME, imageProcessWorker],
      [UPLOADS_CLEANUP_QUEUE_NAME, uploadsCleanupWorker],
      [QUOTE_EXPIRY_QUEUE_NAME, quoteExpiryWorker],
      [LISTING_EXPIRY_QUEUE_NAME, listingExpiryWorker],
      [EMAIL_QUEUE_NAME, emailWorker],
      [NOTIFY_QUEUE_NAME, notifyWorker],
      [NOTIFY_SWEEP_QUEUE_NAME, notifySweepWorker],
      [PUSH_RECEIPTS_QUEUE_NAME, pushReceiptsWorker],
      [NOTIFICATIONS_CLEANUP_QUEUE_NAME, notificationsCleanupWorker],
      [GDPR_EXPORT_QUEUE_NAME, gdprExportWorker],
      [GDPR_SWEEP_QUEUE_NAME, gdprSweepWorker],
    ] as const) {
      worker.on('failed', (job, err) => {
        this.logger.error({ err, jobId: job?.id, queue: name }, 'worker: job failed');
        reportJobFailure(name, job, err);
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
