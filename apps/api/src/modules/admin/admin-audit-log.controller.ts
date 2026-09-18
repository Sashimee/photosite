import { Controller, Get, Inject, Query, Req, UseGuards } from '@nestjs/common';
import { AdminAuditLogQuerySchema } from '@photoo/shared';
import type { FastifyRequest } from 'fastify';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { OriginGuard } from '../auth/origin-guard.js';
import { AdminAccessService } from './admin-access.service.js';
import { AdminAuditLogService } from './admin-audit-log.service.js';

@Controller('admin/audit-log')
@UseGuards(OriginGuard)
export class AdminAuditLogController {
  constructor(
    @Inject(AdminAccessService) private readonly adminAccess: AdminAccessService,
    @Inject(AdminAuditLogService) private readonly adminAuditLog: AdminAuditLogService,
  ) {}

  @Get()
  async list(
    @Query(new ZodValidationPipe(AdminAuditLogQuerySchema))
    query: ReturnType<(typeof AdminAuditLogQuerySchema)['parse']>,
    @Req() request: FastifyRequest,
  ) {
    await this.adminAccess.requirePermission(request, 'superadmin');
    return this.adminAuditLog.list(query);
  }
}
