import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { OriginGuard } from '../auth/origin-guard.js';
import { DevicesController } from './devices.controller.js';
import { DevicesRateLimitService } from './devices-rate-limit.service.js';
import { NotificationPreferencesController } from './notification-preferences.controller.js';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsService } from './notifications.service.js';
import { NotifyQueueService } from './notify-queue.service.js';

@Module({
  imports: [AuthModule],
  controllers: [NotificationsController, NotificationPreferencesController, DevicesController],
  providers: [NotificationsService, NotifyQueueService, DevicesRateLimitService, OriginGuard],
  exports: [NotificationsService],
})
export class NotificationsModule {}
