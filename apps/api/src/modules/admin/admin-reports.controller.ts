import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  AdminReportsQuerySchema,
  IdSchema,
  ResolveReportRequestSchema,
  TakedownReportRequestSchema,
} from '@photoo/shared';
import type { FastifyRequest } from 'fastify';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { OriginGuard } from '../auth/origin-guard.js';
import { AdminAccessService } from './admin-access.service.js';
import { AdminMutationRateLimitService } from './admin-mutation-rate-limit.service.js';
import { AdminReportsService } from './admin-reports.service.js';

@Controller('admin/reports')
@UseGuards(OriginGuard)
export class AdminReportsController {
  constructor(
    @Inject(AdminAccessService) private readonly adminAccess: AdminAccessService,
    @Inject(AdminReportsService) private readonly adminReports: AdminReportsService,
    @Inject(AdminMutationRateLimitService)
    private readonly rateLimit: AdminMutationRateLimitService,
  ) {}

  @Get()
  async list(
    @Query(new ZodValidationPipe(AdminReportsQuerySchema))
    query: ReturnType<(typeof AdminReportsQuerySchema)['parse']>,
    @Req() request: FastifyRequest,
  ) {
    await this.adminAccess.requirePermission(request, 'moderation');
    return this.adminReports.list(query);
  }

  @HttpCode(200)
  @Post(':id/resolve')
  async resolve(
    @Param('id', new ZodValidationPipe(IdSchema)) id: string,
    @Body(new ZodValidationPipe(ResolveReportRequestSchema))
    body: ReturnType<(typeof ResolveReportRequestSchema)['parse']>,
    @Req() request: FastifyRequest,
  ) {
    const { user } = await this.adminAccess.requirePermission(request, 'moderation');
    await this.rateLimit.enforce(user.id);
    return this.adminReports.resolve(user, id, body.status, body.resolution, request.ip);
  }

  @HttpCode(200)
  @Post(':id/takedown')
  async takedown(
    @Param('id', new ZodValidationPipe(IdSchema)) id: string,
    @Body(new ZodValidationPipe(TakedownReportRequestSchema))
    body: ReturnType<(typeof TakedownReportRequestSchema)['parse']>,
    @Req() request: FastifyRequest,
  ) {
    const { user } = await this.adminAccess.requirePermission(request, 'moderation');
    await this.rateLimit.enforce(user.id);
    return this.adminReports.takedown(user, id, body.resolution, request.ip);
  }
}
