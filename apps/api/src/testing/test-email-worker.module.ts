import type { OnApplicationShutdown } from '@nestjs/common';
import { Inject, Injectable, Module } from '@nestjs/common';
import { EMAIL_QUEUE_NAME } from '@photoo/shared';
import { createEmailProcessor, createMailTransport } from '@photoo/worker';
import { Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { Logger } from 'nestjs-pino';
import { APP_CONFIG, type Env } from '../config/env.js';

// Matches infra/docker/compose.dev.yml and .github/workflows/ci.yml; the API
// itself has no SMTP config, since the worker owns delivery.
const MAILPIT_SMTP_HOST = '127.0.0.1';
const MAILPIT_SMTP_PORT = 1025;

// Replaces the deleted DevMailWorker: reuses the real processor/transport
// from @photoo/worker so integration suites can still read a delivered
// message from Mailpit, without the API depending on nodemailer itself.
@Injectable()
class TestEmailWorkerService implements OnApplicationShutdown {
  private readonly connection: Redis;
  private readonly worker: Worker;

  constructor(@Inject(APP_CONFIG) config: Env, @Inject(Logger) logger: Logger) {
    this.connection = new Redis(config.REDIS_URL, {
      maxRetriesPerRequest: null,
      retryStrategy: () => null,
    });
    const mailTransport = createMailTransport({
      SMTP_HOST: MAILPIT_SMTP_HOST,
      SMTP_PORT: MAILPIT_SMTP_PORT,
      SMTP_SECURE: false,
      SMTP_FROM: 'dev@photoo.test',
    });
    this.worker = new Worker(EMAIL_QUEUE_NAME, createEmailProcessor({ mailTransport, logger }), {
      connection: this.connection,
    });
    this.worker.on('failed', (job, err) => {
      logger.error({ err, jobId: job?.id }, 'test email worker: job failed');
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker.close();
    this.connection.disconnect();
  }
}

@Module({ providers: [TestEmailWorkerService] })
export class TestEmailWorkerModule {}
