import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  AttachVerificationDocumentRequestSchema,
  CreateVerificationCaseRequestSchema,
  UpdateVerificationCaseRequestSchema,
} from '@photoo/shared';
import type { FastifyRequest } from 'fastify';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { AUTH_INSTANCE } from '../auth/auth-instance.provider.js';
import type { Auth } from '../auth/auth-instance.js';
import { OriginGuard } from '../auth/origin-guard.js';
import { requireSession } from '../auth/session.js';
import { VerificationService } from './verification.service.js';

@Controller('me/verification-case')
@UseGuards(OriginGuard)
export class MyVerificationCaseController {
  constructor(
    @Inject(AUTH_INSTANCE) private readonly auth: Auth,
    @Inject(VerificationService) private readonly verification: VerificationService,
  ) {}

  @Get()
  async getOwn(@Req() request: FastifyRequest) {
    const { user } = await requireSession(this.auth, request);
    return this.verification.getOwn(user);
  }

  @Post()
  async create(
    @Body(new ZodValidationPipe(CreateVerificationCaseRequestSchema))
    body: ReturnType<(typeof CreateVerificationCaseRequestSchema)['parse']>,
    @Req() request: FastifyRequest,
  ) {
    const { user } = await requireSession(this.auth, request);
    return this.verification.create(user, body);
  }

  @Patch()
  async update(
    @Body(new ZodValidationPipe(UpdateVerificationCaseRequestSchema))
    body: ReturnType<(typeof UpdateVerificationCaseRequestSchema)['parse']>,
    @Req() request: FastifyRequest,
  ) {
    const { user } = await requireSession(this.auth, request);
    return this.verification.update(user, body);
  }

  @Post('documents')
  async attachDocument(
    @Body(new ZodValidationPipe(AttachVerificationDocumentRequestSchema))
    body: ReturnType<(typeof AttachVerificationDocumentRequestSchema)['parse']>,
    @Req() request: FastifyRequest,
  ) {
    const { user } = await requireSession(this.auth, request);
    return this.verification.attachDocument(user, body);
  }

  @HttpCode(200)
  @Post('submit')
  async submit(@Req() request: FastifyRequest) {
    const { user } = await requireSession(this.auth, request);
    return this.verification.submit(user);
  }
}
