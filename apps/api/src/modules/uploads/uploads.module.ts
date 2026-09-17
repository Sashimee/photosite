import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { OriginGuard } from '../auth/origin-guard.js';
import { FileScanQueueService } from './file-scan-queue.service.js';
import { UploadsRateLimitService } from './uploads-rate-limit.service.js';
import { UploadsController } from './uploads.controller.js';
import { UploadsService } from './uploads.service.js';

@Module({
  imports: [AuthModule],
  controllers: [UploadsController],
  providers: [UploadsService, UploadsRateLimitService, FileScanQueueService, OriginGuard],
})
export class UploadsModule {}
