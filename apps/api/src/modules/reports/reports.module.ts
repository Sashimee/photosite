import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { OriginGuard } from '../auth/origin-guard.js';
import { ReportsController } from './reports.controller.js';
import { ReportsRateLimitService } from './reports-rate-limit.service.js';
import { ReportsService } from './reports.service.js';

@Module({
  imports: [AuthModule],
  controllers: [ReportsController],
  providers: [ReportsService, ReportsRateLimitService, OriginGuard],
})
export class ReportsModule {}
