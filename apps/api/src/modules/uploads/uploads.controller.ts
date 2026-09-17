import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { CreateUploadRequestSchema, IdSchema, type UploadPurpose } from '@photoo/shared';
import type { FastifyRequest } from 'fastify';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { AUTH_INSTANCE } from '../auth/auth-instance.provider.js';
import type { Auth } from '../auth/auth-instance.js';
import { OriginGuard } from '../auth/origin-guard.js';
import { requireSession } from '../auth/session.js';
import { UploadsRateLimitService } from './uploads-rate-limit.service.js';
import { UploadsService } from './uploads.service.js';

@Controller('uploads')
@UseGuards(OriginGuard)
export class UploadsController {
  constructor(
    @Inject(AUTH_INSTANCE) private readonly auth: Auth,
    @Inject(UploadsService) private readonly uploads: UploadsService,
    @Inject(UploadsRateLimitService) private readonly rateLimit: UploadsRateLimitService,
  ) {}

  @Post()
  async create(
    @Body(new ZodValidationPipe(CreateUploadRequestSchema)) body: unknown,
    @Req() request: FastifyRequest,
  ) {
    const input = body as { purpose: UploadPurpose; mimeType: string; sizeBytes: number };
    const { user } = await requireSession(this.auth, request);
    await this.rateLimit.enforce('create', request.ip, user.id);
    return this.uploads.createUpload(user.id, input);
  }

  @HttpCode(200)
  @Post(':id/complete')
  async complete(
    @Param('id', new ZodValidationPipe(IdSchema)) id: string,
    @Req() request: FastifyRequest,
  ) {
    const { user } = await requireSession(this.auth, request);
    return this.uploads.complete(user.id, id);
  }

  @Get(':id')
  async status(
    @Param('id', new ZodValidationPipe(IdSchema)) id: string,
    @Req() request: FastifyRequest,
  ) {
    const { user } = await requireSession(this.auth, request);
    return this.uploads.getStatus(user.id, id);
  }

  @Get(':id/download')
  async download(
    @Param('id', new ZodValidationPipe(IdSchema)) id: string,
    @Req() request: FastifyRequest,
  ) {
    const { user } = await requireSession(this.auth, request);
    return this.uploads.presignDownload(user.id, id);
  }
}
