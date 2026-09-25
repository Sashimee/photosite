import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { OriginGuard } from '../auth/origin-guard.js';
import { CountriesModule } from '../countries/countries.module.js';
import { ConsentsRateLimitService } from './consents-rate-limit.service.js';
import { ConsentsController } from './consents.controller.js';
import { ConsentsService } from './consents.service.js';
import { DataRequestsController } from './data-requests.controller.js';
import { DataRequestsRateLimitService } from './data-requests-rate-limit.service.js';
import { DataRequestsService } from './data-requests.service.js';
import { GdprExportQueueModule } from './gdpr-export-queue.module.js';
import { PublicConsentsController } from './public-consents.controller.js';

@Module({
  imports: [AuthModule, CountriesModule, GdprExportQueueModule],
  controllers: [ConsentsController, PublicConsentsController, DataRequestsController],
  providers: [
    ConsentsService,
    ConsentsRateLimitService,
    DataRequestsService,
    DataRequestsRateLimitService,
    OriginGuard,
  ],
})
export class GdprModule {}
