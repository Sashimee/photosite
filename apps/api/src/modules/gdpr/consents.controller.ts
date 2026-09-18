import { Body, Controller, Get, Inject, Put, Req, UseGuards } from '@nestjs/common';
import { UpdateConsentsRequestSchema } from '@photoo/shared';
import type { FastifyRequest } from 'fastify';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { AUTH_INSTANCE } from '../auth/auth-instance.provider.js';
import type { Auth } from '../auth/auth-instance.js';
import { OriginGuard } from '../auth/origin-guard.js';
import { requireSession } from '../auth/session.js';
import { ConsentsService } from './consents.service.js';
import { userAgentHeader } from './user-agent.js';

@Controller('me/consents')
@UseGuards(OriginGuard)
export class ConsentsController {
  constructor(
    @Inject(AUTH_INSTANCE) private readonly auth: Auth,
    @Inject(ConsentsService) private readonly consents: ConsentsService,
  ) {}

  @Get()
  async get(@Req() request: FastifyRequest) {
    const { user } = await requireSession(this.auth, request);
    return this.consents.getState(user);
  }

  @Put()
  async update(
    @Body(new ZodValidationPipe(UpdateConsentsRequestSchema))
    body: ReturnType<(typeof UpdateConsentsRequestSchema)['parse']>,
    @Req() request: FastifyRequest,
  ) {
    const { user } = await requireSession(this.auth, request);
    return this.consents.updateForUser(user, body, request.ip, userAgentHeader(request));
  }
}
