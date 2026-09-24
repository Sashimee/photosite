import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { OriginGuard } from '../auth/origin-guard.js';
import { ProfessionalProfileController } from './professional-profile.controller.js';
import { ProfessionalsService } from './professionals.service.js';

@Module({
  imports: [AuthModule],
  controllers: [ProfessionalProfileController],
  providers: [ProfessionalsService, OriginGuard],
  exports: [ProfessionalsService],
})
export class ProfessionalsModule {}
