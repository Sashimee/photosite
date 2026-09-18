import { Body, Controller, HttpCode, Inject, Post, Req, UseGuards } from '@nestjs/common';
import { CreateConsentRequestSchema } from '@photoo/shared';
import type { FastifyRequest } from 'fastify';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { AUTH_INSTANCE } from '../auth/auth-instance.provider.js';
import type { Auth } from '../auth/auth-instance.js';
import { OriginGuard } from '../auth/origin-guard.js';
import { getOptionalSession } from '../auth/session.js';
import { ConsentsRateLimitService } from './consents-rate-limit.service.js';
import { ConsentsService } from './consents.service.js';
import { userAgentHeader } from './user-agent.js';

@Controller('consents')
@UseGuards(OriginGuard)
export class PublicConsentsController {
  constructor(
    @Inject(AUTH_INSTANCE) private readonly auth: Auth,
    @Inject(ConsentsService) private readonly consents: ConsentsService,
    @Inject(ConsentsRateLimitService) private readonly rateLimit: ConsentsRateLimitService,
  ) {}

  @HttpCode(201)
  @Post()
  async create(
    @Body(new ZodValidationPipe(CreateConsentRequestSchema))
    body: ReturnType<(typeof CreateConsentRequestSchema)['parse']>,
    @Req() request: FastifyRequest,
  ) {
    const session = await getOptionalSession(this.auth, request);
    await this.rateLimit.enforce(request.ip, session?.user.id ?? null);
    return this.consents.record(
      body,
      session ? { id: session.user.id } : null,
      request.ip,
      userAgentHeader(request),
    );
  }
}
