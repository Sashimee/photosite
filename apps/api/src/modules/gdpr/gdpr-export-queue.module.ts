import { Module } from '@nestjs/common';
import { GdprExportQueueService } from './gdpr-export-queue.service.js';

@Module({
  providers: [GdprExportQueueService],
  exports: [GdprExportQueueService],
})
export class GdprExportQueueModule {}
