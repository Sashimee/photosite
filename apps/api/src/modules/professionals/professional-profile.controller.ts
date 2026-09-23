import { Body, Controller, Get, Inject, Patch, Post, Req, UseGuards } from '@nestjs/common';
import {
  CreateProfessionalProfileRequestSchema,
  UpdateProfessionalProfileRequestSchema,
} from '@photoo/shared';
import type { FastifyRequest } from 'fastify';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { AUTH_INSTANCE } from '../auth/auth-instance.provider.js';
import type { Auth } from '../auth/auth-instance.js';
import { OriginGuard } from '../auth/origin-guard.js';
import { requireSession } from '../auth/session.js';
import { ProfessionalsService } from './professionals.service.js';

@Controller('me/professional-profile')
@UseGuards(OriginGuard)
export class ProfessionalProfileController {
  constructor(
    @Inject(AUTH_INSTANCE) private readonly auth: Auth,
    @Inject(ProfessionalsService) private readonly professionals: ProfessionalsService,
  ) {}

  @Post()
  async create(
    @Body(new ZodValidationPipe(CreateProfessionalProfileRequestSchema))
    body: ReturnType<(typeof CreateProfessionalProfileRequestSchema)['parse']>,
    @Req() request: FastifyRequest,
  ) {
    const { user } = await requireSession(this.auth, request);
    return this.professionals.create(user, body, request.ip);
  }

  @Get()
  async getOwn(@Req() request: FastifyRequest) {
    const { user } = await requireSession(this.auth, request);
    return this.professionals.getOwn(user);
  }

  @Patch()
  async update(
    @Body(new ZodValidationPipe(UpdateProfessionalProfileRequestSchema))
    body: ReturnType<(typeof UpdateProfessionalProfileRequestSchema)['parse']>,
    @Req() request: FastifyRequest,
  ) {
    const { user } = await requireSession(this.auth, request);
    return this.professionals.update(user, body);
  }
}
