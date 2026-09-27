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
  AdminProvenanceQuerySchema,
  IdSchema,
  ProvenanceDecisionRequestSchema,
} from '@photoo/shared';
import type { FastifyRequest } from 'fastify';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { OriginGuard } from '../auth/origin-guard.js';
import { AdminAccessService } from './admin-access.service.js';
import { AdminMutationRateLimitService } from './admin-mutation-rate-limit.service.js';
import { AdminProvenanceService } from './admin-provenance.service.js';

@Controller('admin/provenance')
@UseGuards(OriginGuard)
export class AdminProvenanceController {
  constructor(
    @Inject(AdminAccessService) private readonly adminAccess: AdminAccessService,
    @Inject(AdminProvenanceService) private readonly adminProvenance: AdminProvenanceService,
    @Inject(AdminMutationRateLimitService)
    private readonly rateLimit: AdminMutationRateLimitService,
  ) {}

  @Get()
  async list(
    @Query(new ZodValidationPipe(AdminProvenanceQuerySchema))
    query: ReturnType<(typeof AdminProvenanceQuerySchema)['parse']>,
    @Req() request: FastifyRequest,
  ) {
    await this.adminAccess.requirePermission(request, 'moderation');
    return this.adminProvenance.list(query);
  }

  @Get(':id')
  async getById(
    @Param('id', new ZodValidationPipe(IdSchema)) id: string,
    @Req() request: FastifyRequest,
  ) {
    await this.adminAccess.requirePermission(request, 'moderation');
    return this.adminProvenance.getById(id);
  }

  @HttpCode(200)
  @Post(':id/decision')
  async decide(
    @Param('id', new ZodValidationPipe(IdSchema)) id: string,
    @Body(new ZodValidationPipe(ProvenanceDecisionRequestSchema))
    body: ReturnType<(typeof ProvenanceDecisionRequestSchema)['parse']>,
    @Req() request: FastifyRequest,
  ) {
    const { user } = await this.adminAccess.requirePermission(request, 'moderation');
    await this.rateLimit.enforce(user.id);
    return this.adminProvenance.decide(user, id, body, request.ip);
  }

  @HttpCode(200)
  @Post(':id/recheck')
  async recheck(
    @Param('id', new ZodValidationPipe(IdSchema)) id: string,
    @Req() request: FastifyRequest,
  ) {
    const { user } = await this.adminAccess.requirePermission(request, 'moderation');
    await this.rateLimit.enforce(user.id);
    return this.adminProvenance.recheck(user, id, request.ip);
  }
}
