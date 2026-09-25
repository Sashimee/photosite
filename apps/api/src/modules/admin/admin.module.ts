import { Module } from '@nestjs/common';
import { PlatformSettingsModule } from '../../common/platform-settings/platform-settings.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { OriginGuard } from '../auth/origin-guard.js';
import { ChatSocketBridgeModule } from '../chat/chat-socket-bridge.module.js';
import { GdprExportQueueModule } from '../gdpr/gdpr-export-queue.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { AdminAccessService } from './admin-access.service.js';
import { AdminAuditLogController } from './admin-audit-log.controller.js';
import { AdminAuditLogRepository } from './admin-audit-log.repository.js';
import { AdminAuditLogService } from './admin-audit-log.service.js';
import { AdminAuditService } from './admin-audit.service.js';
import { AdminDataRequestsController } from './admin-data-requests.controller.js';
import { AdminDataRequestsRepository } from './admin-data-requests.repository.js';
import { AdminDataRequestsService } from './admin-data-requests.service.js';
import { AdminEmailTemplatesController } from './admin-email-templates.controller.js';
import { AdminEmailTemplatesService } from './admin-email-templates.service.js';
import { AdminMeController } from './admin-me.controller.js';
import { AdminMeService } from './admin-me.service.js';
import { AdminMutationRateLimitService } from './admin-mutation-rate-limit.service.js';
import { AdminPermissionsService } from './admin-permissions.service.js';
import { AdminReportsController } from './admin-reports.controller.js';
import { AdminReportsRepository } from './admin-reports.repository.js';
import { AdminReportsService } from './admin-reports.service.js';
import { AdminSettingsController } from './admin-settings.controller.js';
import { AdminSettingsService } from './admin-settings.service.js';
import { AdminUsersController } from './admin-users.controller.js';
import { AdminUsersRepository } from './admin-users.repository.js';
import { AdminUsersService } from './admin-users.service.js';

@Module({
  imports: [
    AuthModule,
    ChatSocketBridgeModule,
    PlatformSettingsModule,
    NotificationsModule,
    GdprExportQueueModule,
  ],
  controllers: [
    AdminMeController,
    AdminUsersController,
    AdminSettingsController,
    AdminAuditLogController,
    AdminReportsController,
    AdminEmailTemplatesController,
    AdminDataRequestsController,
  ],
  providers: [
    AdminAccessService,
    AdminAuditService,
    AdminPermissionsService,
    AdminMutationRateLimitService,
    AdminMeService,
    AdminUsersService,
    AdminUsersRepository,
    AdminSettingsService,
    AdminAuditLogService,
    AdminAuditLogRepository,
    AdminReportsService,
    AdminReportsRepository,
    AdminEmailTemplatesService,
    AdminDataRequestsService,
    AdminDataRequestsRepository,
    OriginGuard,
  ],
  exports: [
    AdminAccessService,
    AdminAuditService,
    AdminPermissionsService,
    AdminMutationRateLimitService,
  ],
})
export class AdminModule {}
