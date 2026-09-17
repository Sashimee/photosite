import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { OriginGuard } from '../auth/origin-guard.js';
import { MyPhotographerProfileController } from './my-photographer-profile.controller.js';
import { PhotographersController } from './photographers.controller.js';
import { PortfolioCleanupQueueService } from './portfolio-cleanup-queue.service.js';
import { PortfolioService } from './portfolio.service.js';
import { ProfilesRateLimitService } from './profiles-rate-limit.service.js';
import { ProfilesRepository } from './profiles.repository.js';
import { ProfilesService } from './profiles.service.js';

@Module({
  imports: [AuthModule],
  controllers: [PhotographersController, MyPhotographerProfileController],
  providers: [
    ProfilesService,
    ProfilesRepository,
    ProfilesRateLimitService,
    PortfolioService,
    PortfolioCleanupQueueService,
    OriginGuard,
  ],
  exports: [ProfilesService, ProfilesRepository],
})
export class ProfilesModule {}
