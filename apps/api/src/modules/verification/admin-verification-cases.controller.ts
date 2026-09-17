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
import { requireAdminSession } from '../../common/auth/require-admin.js';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { AUTH_INSTANCE } from '../auth/auth-instance.provider.js';
import type { Auth } from '../auth/auth-instance.js';
import { OriginGuard } from '../auth/origin-guard.js';
import { AdminVerificationService } from './admin-verification.service.js';

@Controller('admin/verification-cases')
@UseGuards(OriginGuard)
export class AdminVerificationCasesController {
  constructor(
    @Inject(AUTH_INSTANCE) private readonly auth: Auth,
    @Inject(AdminVerificationService) private readonly adminVerification: AdminVerificationService,
  ) {}

  @Get()
  async list(
    @Query(new ZodValidationPipe(AdminVerificationCasesQuerySchema))
    query: ReturnType<(typeof AdminVerificationCasesQuerySchema)['parse']>,
    @Req() request: FastifyRequest,
  ) {
    await requireAdminSession(this.auth, request);
    return this.adminVerification.list(query);
  }

  @Get(':id')
  async get(
    @Param('id', new ZodValidationPipe(IdSchema)) id: string,
    @Req() request: FastifyRequest,
  ) {
    const { user } = await requireAdminSession(this.auth, request);
    return this.adminVerification.get(user, id, request.ip);
  }

  @HttpCode(200)
  @Post(':id/start-review')
  async startReview(
    @Param('id', new ZodValidationPipe(IdSchema)) id: string,
    @Req() request: FastifyRequest,
  ) {
    const { user } = await requireAdminSession(this.auth, request);
    return this.adminVerification.startReview(user, id, request.ip);
  }

  @HttpCode(200)
  @Post(':id/approve')
  async approve(
    @Param('id', new ZodValidationPipe(IdSchema)) id: string,
    @Req() request: FastifyRequest,
  ) {
    const { user } = await requireAdminSession(this.auth, request);
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
    const { user } = await requireAdminSession(this.auth, request);
    return this.adminVerification.reject(user, id, body.reason, request.ip);
  }
}
