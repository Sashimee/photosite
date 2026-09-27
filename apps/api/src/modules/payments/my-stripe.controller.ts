import { Controller, HttpCode, Inject, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AUTH_INSTANCE } from '../auth/auth-instance.provider.js';
import type { Auth } from '../auth/auth-instance.js';
import { OriginGuard } from '../auth/origin-guard.js';
import { requireSession } from '../auth/session.js';
import { StripeConnectService } from './stripe-connect.service.js';

@Controller('me/stripe')
@UseGuards(OriginGuard)
export class MyStripeController {
  constructor(
    @Inject(AUTH_INSTANCE) private readonly auth: Auth,
    @Inject(StripeConnectService) private readonly connect: StripeConnectService,
  ) {}

  @Post('account')
  async createAccount(
    @Req() request: FastifyRequest,
    @Res({ passthrough: false }) reply: FastifyReply,
  ): Promise<void> {
    const { user } = await requireSession(this.auth, request);
    const result = await this.connect.createAccount(user, request.ip);
    reply.status(result.status);
    reply.send(result.data);
  }

  @HttpCode(200)
  @Post('account-link')
  async createAccountLink(@Req() request: FastifyRequest) {
    const { user } = await requireSession(this.auth, request);
    return this.connect.createAccountLink(user);
  }
}
