import { Controller, Get, Inject, Query, Req, UseGuards } from '@nestjs/common';
import { AdminDataRequestsQuerySchema } from '@photoo/shared';
import type { FastifyRequest } from 'fastify';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { OriginGuard } from '../auth/origin-guard.js';
import { AdminAccessService } from './admin-access.service.js';
import { AdminDataRequestsService } from './admin-data-requests.service.js';

@Controller('admin/data-requests')
@UseGuards(OriginGuard)
export class AdminDataRequestsController {
  constructor(
    @Inject(AdminAccessService) private readonly adminAccess: AdminAccessService,
    @Inject(AdminDataRequestsService) private readonly adminDataRequests: AdminDataRequestsService,
  ) {}

  @Get()
  async list(
    @Query(new ZodValidationPipe(AdminDataRequestsQuerySchema))
    query: ReturnType<(typeof AdminDataRequestsQuerySchema)['parse']>,
    @Req() request: FastifyRequest,
  ) {
    await this.adminAccess.requirePermission(request, 'support');
    return this.adminDataRequests.list(query);
  }
}
