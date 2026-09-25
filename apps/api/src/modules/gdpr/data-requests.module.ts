import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { OriginGuard } from '../auth/origin-guard.js';
import { DataRequestsController } from './data-requests.controller.js';
import { DataRequestsRateLimitService } from './data-requests-rate-limit.service.js';
import { DataRequestsService } from './data-requests.service.js';
import { GdprExportQueueModule } from './gdpr-export-queue.module.js';

@Module({
  imports: [AuthModule, GdprExportQueueModule],
  controllers: [DataRequestsController],
  providers: [DataRequestsService, DataRequestsRateLimitService, OriginGuard],
  exports: [DataRequestsService],
})
export class DataRequestsModule {}
