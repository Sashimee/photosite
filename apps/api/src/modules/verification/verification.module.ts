import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { OriginGuard } from '../auth/origin-guard.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { AdminVerificationCasesController } from './admin-verification-cases.controller.js';
import { AdminVerificationService } from './admin-verification.service.js';
import { MyVerificationCaseController } from './my-verification-case.controller.js';
import { VerificationEncryptionService } from './verification-encryption.service.js';
import { VerificationRateLimitService } from './verification-rate-limit.service.js';
import { VerificationRepository } from './verification.repository.js';
import { VerificationService } from './verification.service.js';

@Module({
  imports: [AuthModule, AdminModule, NotificationsModule],
  controllers: [MyVerificationCaseController, AdminVerificationCasesController],
  providers: [
    VerificationService,
    AdminVerificationService,
    VerificationRepository,
    VerificationEncryptionService,
    VerificationRateLimitService,
    OriginGuard,
  ],
  exports: [VerificationService],
})
export class VerificationModule {}
