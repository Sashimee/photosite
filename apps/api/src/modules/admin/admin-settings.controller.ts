import { Body, Controller, Get, Inject, Patch, Req, UseGuards } from '@nestjs/common';
import { UpdatePlatformSettingsRequestSchema } from '@photoo/shared';
import type { FastifyRequest } from 'fastify';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { OriginGuard } from '../auth/origin-guard.js';
import { AdminAccessService } from './admin-access.service.js';
import { AdminMutationRateLimitService } from './admin-mutation-rate-limit.service.js';
import { AdminSettingsService } from './admin-settings.service.js';

@Controller('admin/settings')
@UseGuards(OriginGuard)
export class AdminSettingsController {
  constructor(
    @Inject(AdminAccessService) private readonly adminAccess: AdminAccessService,
    @Inject(AdminSettingsService) private readonly adminSettings: AdminSettingsService,
    @Inject(AdminMutationRateLimitService)
    private readonly rateLimit: AdminMutationRateLimitService,
  ) {}

  @Get()
  async get(@Req() request: FastifyRequest) {
    await this.adminAccess.requirePermission(request, 'superadmin');
    return this.adminSettings.get();
  }

  @Patch()
  async patch(
    @Body(new ZodValidationPipe(UpdatePlatformSettingsRequestSchema))
    body: ReturnType<(typeof UpdatePlatformSettingsRequestSchema)['parse']>,
    @Req() request: FastifyRequest,
  ) {
    const { user } = await this.adminAccess.requirePermission(request, 'superadmin');
    await this.rateLimit.enforce(user.id);
    return this.adminSettings.patch(user, body, request.ip);
  }
}
