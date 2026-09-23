import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { OriginGuard } from '../auth/origin-guard.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { ProfessionalsModule } from '../professionals/professionals.module.js';
import { JobApplicationsController } from './job-applications.controller.js';
import { JobApplicationsService } from './job-applications.service.js';
import { JobBoardRateLimitService } from './job-board-rate-limit.service.js';
import { JobBoardRepository } from './job-board.repository.js';
import { JobOffersController } from './job-offers.controller.js';
import { JobOffersService } from './job-offers.service.js';

@Module({
  imports: [AuthModule, ProfessionalsModule, NotificationsModule],
  controllers: [JobOffersController, JobApplicationsController],
  providers: [
    JobOffersService,
    JobApplicationsService,
    JobBoardRepository,
    JobBoardRateLimitService,
    OriginGuard,
  ],
})
export class JobBoardModule {}
