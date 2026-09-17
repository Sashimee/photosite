import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { OriginGuard } from '../auth/origin-guard.js';
import { ProfilesModule } from '../profiles/profiles.module.js';
import { RequestsController } from './requests.controller.js';
import { RequestsRateLimitService } from './requests-rate-limit.service.js';
import { RequestsRepository } from './requests.repository.js';
import { RequestsService } from './requests.service.js';

@Module({
  imports: [AuthModule, ProfilesModule],
  controllers: [RequestsController],
  providers: [RequestsService, RequestsRepository, RequestsRateLimitService, OriginGuard],
})
export class RequestsModule {}
