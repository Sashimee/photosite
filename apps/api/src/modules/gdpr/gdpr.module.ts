import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { OriginGuard } from '../auth/origin-guard.js';
import { ConsentsRateLimitService } from './consents-rate-limit.service.js';
import { ConsentsController } from './consents.controller.js';
import { ConsentsService } from './consents.service.js';
import { PublicConsentsController } from './public-consents.controller.js';

@Module({
  imports: [AuthModule],
  controllers: [ConsentsController, PublicConsentsController],
  providers: [ConsentsService, ConsentsRateLimitService, OriginGuard],
})
export class GdprModule {}
