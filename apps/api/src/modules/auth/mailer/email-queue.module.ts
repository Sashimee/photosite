import type { OnApplicationShutdown } from '@nestjs/common';
import { Global, Inject, Injectable, Module } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { APP_CONFIG, type Env } from '../../../config/env.js';
import { DevMailWorker } from './dev-mail-worker.js';
import { EmailQueueService } from './email-queue.service.js';

export const DEV_MAIL_WORKER = Symbol('DEV_MAIL_WORKER');

@Injectable()
class DevMailWorkerHolder implements OnApplicationShutdown {
  readonly worker: DevMailWorker | null;

  constructor(@Inject(APP_CONFIG) config: Env, @Inject(Logger) logger: Logger) {
    this.worker =
      config.NODE_ENV === 'production' || !config.DEV_MAIL_WORKER
        ? null
        : new DevMailWorker(config, logger);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.onApplicationShutdown();
  }
}

@Global()
@Module({
  providers: [EmailQueueService, { provide: DEV_MAIL_WORKER, useClass: DevMailWorkerHolder }],
  exports: [EmailQueueService],
})
export class EmailQueueModule {}

export { DevMailWorkerHolder };
