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
  AdminVerificationCasesQuerySchema,
  IdSchema,
  RejectVerificationCaseRequestSchema,
} from '@photoo/shared';
import type { FastifyRequest } from 'fastify';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { AdminAccessService } from '../admin/admin-access.service.js';
import { OriginGuard } from '../auth/origin-guard.js';
import { AdminVerificationService } from './admin-verification.service.js';

const REQUIRES_2FA = { requires2fa: true } as const;

@Controller('admin/verification-cases')
@UseGuards(OriginGuard)
export class AdminVerificationCasesController {
  constructor(
    @Inject(AdminAccessService) private readonly adminAccess: AdminAccessService,
    @Inject(AdminVerificationService) private readonly adminVerification: AdminVerificationService,
  ) {}

  @Get()
  async list(
    @Query(new ZodValidationPipe(AdminVerificationCasesQuerySchema))
    query: ReturnType<(typeof AdminVerificationCasesQuerySchema)['parse']>,
    @Req() request: FastifyRequest,
  ) {
    await this.adminAccess.requirePermission(request, 'verification', REQUIRES_2FA);
    return this.adminVerification.list(query);
  }

  @Get(':id')
  async get(
    @Param('id', new ZodValidationPipe(IdSchema)) id: string,
    @Req() request: FastifyRequest,
  ) {
    const { user } = await this.adminAccess.requirePermission(
      request,
      'verification',
      REQUIRES_2FA,
    );
    return this.adminVerification.get(user, id, request.ip);
  }

  @HttpCode(200)
  @Post(':id/start-review')
  async startReview(
    @Param('id', new ZodValidationPipe(IdSchema)) id: string,
    @Req() request: FastifyRequest,
  ) {
    const { user } = await this.adminAccess.requirePermission(
      request,
      'verification',
      REQUIRES_2FA,
    );
    return this.adminVerification.startReview(user, id, request.ip);
  }

  @HttpCode(200)
  @Post(':id/approve')
  async approve(
    @Param('id', new ZodValidationPipe(IdSchema)) id: string,
    @Req() request: FastifyRequest,
  ) {
    const { user } = await this.adminAccess.requirePermission(
      request,
      'verification',
      REQUIRES_2FA,
    );
    return this.adminVerification.approve(user, id, request.ip);
  }

  @HttpCode(200)
  @Post(':id/reject')
  async reject(
    @Param('id', new ZodValidationPipe(IdSchema)) id: string,
    @Body(new ZodValidationPipe(RejectVerificationCaseRequestSchema))
    body: ReturnType<(typeof RejectVerificationCaseRequestSchema)['parse']>,
    @Req() request: FastifyRequest,
  ) {
    const { user } = await this.adminAccess.requirePermission(
      request,
      'verification',
      REQUIRES_2FA,
    );
    return this.adminVerification.reject(user, id, body.reason, request.ip);
  }
}
