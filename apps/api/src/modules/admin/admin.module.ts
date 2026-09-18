import { Module } from '@nestjs/common';
import { PlatformSettingsModule } from '../../common/platform-settings/platform-settings.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { OriginGuard } from '../auth/origin-guard.js';
import { ChatSocketBridgeModule } from '../chat/chat-socket-bridge.module.js';
import { AdminAccessService } from './admin-access.service.js';
import { AdminAuditLogController } from './admin-audit-log.controller.js';
import { AdminAuditLogRepository } from './admin-audit-log.repository.js';
import { AdminAuditLogService } from './admin-audit-log.service.js';
import { AdminAuditService } from './admin-audit.service.js';
import { AdminMutationRateLimitService } from './admin-mutation-rate-limit.service.js';
import { AdminPermissionsService } from './admin-permissions.service.js';
import { AdminSettingsController } from './admin-settings.controller.js';
import { AdminSettingsService } from './admin-settings.service.js';
import { AdminUsersController } from './admin-users.controller.js';
import { AdminUsersRepository } from './admin-users.repository.js';
import { AdminUsersService } from './admin-users.service.js';

@Module({
  imports: [AuthModule, ChatSocketBridgeModule, PlatformSettingsModule],
  controllers: [AdminUsersController, AdminSettingsController, AdminAuditLogController],
  providers: [
    AdminAccessService,
    AdminAuditService,
    AdminPermissionsService,
    AdminMutationRateLimitService,
    AdminUsersService,
    AdminUsersRepository,
    AdminSettingsService,
    AdminAuditLogService,
    AdminAuditLogRepository,
    OriginGuard,
  ],
  exports: [AdminAccessService, AdminAuditService, AdminPermissionsService],
})
export class AdminModule {}
