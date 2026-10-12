import type { OnApplicationShutdown } from '@nestjs/common';
import { Inject, Injectable } from '@nestjs/common';
import {
  BOOKING_DOCUMENTS,
  RECEIPT_PDF_QUEUE_NAME,
  ReceiptPdfJobSchema,
  receiptPdfJobId,
  type BookingDocument,
  type ReceiptPdfJob,
} from '@photoo/shared';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { APP_CONFIG, type Env } from '../../config/env.js';

@Injectable()
export class BookingDocumentsQueueService implements OnApplicationShutdown {
  private readonly connection: Redis;
  readonly queue: Queue<ReceiptPdfJob>;

  constructor(@Inject(APP_CONFIG) config: Env) {
    this.connection = new Redis(config.REDIS_URL, {
      maxRetriesPerRequest: null,
      retryStrategy: () => null,
    });
    this.queue = new Queue<ReceiptPdfJob>(RECEIPT_PDF_QUEUE_NAME, {
      connection: this.connection,
    });
  }

  // The deterministic jobId dedupes release and download-endpoint enqueues
  // while a job is pending. Failed jobs are removed so that id is free again:
  // a retained failure would silently swallow the endpoint's re-enqueue.
  async enqueue(
    bookingId: string,
    documents: readonly BookingDocument[] = BOOKING_DOCUMENTS,
  ): Promise<void> {
    await this.queue.addBulk(
      documents.map((document) => ({
        name: 'receipt-pdf',
        data: ReceiptPdfJobSchema.parse({ bookingId, document }),
        opts: {
          jobId: receiptPdfJobId(bookingId, document),
          removeOnComplete: true,
          removeOnFail: true,
          attempts: 5,
          backoff: { type: 'exponential', delay: 5000 },
        },
      })),
    );
  }

  async onApplicationShutdown(): Promise<void> {
    await this.queue.close();
    this.connection.disconnect();
  }
}
