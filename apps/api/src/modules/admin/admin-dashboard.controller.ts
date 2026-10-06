import { Controller, Get, Inject, Query, Req, UseGuards } from '@nestjs/common';
import { AdminDashboardQuerySchema } from '@photoo/shared';
import type { FastifyRequest } from 'fastify';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { OriginGuard } from '../auth/origin-guard.js';
import { AdminAccessService } from './admin-access.service.js';
import { AdminDashboardService } from './admin-dashboard.service.js';

@Controller('admin/dashboard')
@UseGuards(OriginGuard)
export class AdminDashboardController {
  constructor(
    @Inject(AdminAccessService) private readonly adminAccess: AdminAccessService,
    @Inject(AdminDashboardService) private readonly dashboard: AdminDashboardService,
  ) {}

  @Get()
  async get(
    @Query(new ZodValidationPipe(AdminDashboardQuerySchema))
    query: ReturnType<(typeof AdminDashboardQuerySchema)['parse']>,
    @Req() request: FastifyRequest,
  ) {
    const session = await this.adminAccess.requireSession(request);
    return this.dashboard.get(session.user.id, query);
  }
}
