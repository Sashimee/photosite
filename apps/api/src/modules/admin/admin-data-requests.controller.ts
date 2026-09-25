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
  AdminDataRequestsQuerySchema,
  AdminLogDataRequestBodySchema,
  IdSchema,
} from '@photoo/shared';
import type { FastifyRequest } from 'fastify';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { OriginGuard } from '../auth/origin-guard.js';
import { AdminAccessService } from './admin-access.service.js';
import { AdminDataRequestsService } from './admin-data-requests.service.js';
import { AdminMutationRateLimitService } from './admin-mutation-rate-limit.service.js';

@Controller('admin/data-requests')
@UseGuards(OriginGuard)
export class AdminDataRequestsController {
  constructor(
    @Inject(AdminAccessService) private readonly adminAccess: AdminAccessService,
    @Inject(AdminDataRequestsService) private readonly adminDataRequests: AdminDataRequestsService,
    @Inject(AdminMutationRateLimitService)
    private readonly rateLimit: AdminMutationRateLimitService,
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

  @HttpCode(201)
  @Post(':id/retry-export')
  async retryExport(
    @Param('id', new ZodValidationPipe(IdSchema)) id: string,
    @Req() request: FastifyRequest,
  ) {
    const { user } = await this.adminAccess.requirePermission(request, 'support');
    await this.rateLimit.enforce(user.id);
    return this.adminDataRequests.retryExport(user, id, request.ip);
  }

  @HttpCode(201)
  @Post()
  async logOffline(
    @Body(new ZodValidationPipe(AdminLogDataRequestBodySchema))
    body: ReturnType<(typeof AdminLogDataRequestBodySchema)['parse']>,
    @Req() request: FastifyRequest,
  ) {
    const { user } = await this.adminAccess.requirePermission(request, 'support');
    await this.rateLimit.enforce(user.id);
    return this.adminDataRequests.logOffline(user, body, request.ip);
  }
}
