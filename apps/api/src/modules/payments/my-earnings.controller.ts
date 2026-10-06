import { Controller, Get, Inject, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AUTH_INSTANCE } from '../auth/auth-instance.provider.js';
import type { Auth } from '../auth/auth-instance.js';
import { OriginGuard } from '../auth/origin-guard.js';
import { requireSession } from '../auth/session.js';
import { EarningsService } from './earnings.service.js';

@Controller('me/earnings')
@UseGuards(OriginGuard)
export class MyEarningsController {
  constructor(
    @Inject(AUTH_INSTANCE) private readonly auth: Auth,
    @Inject(EarningsService) private readonly earnings: EarningsService,
  ) {}

  @Get()
  async getOwn(@Req() request: FastifyRequest) {
    const { user } = await requireSession(this.auth, request);
    return this.earnings.getOwn(user);
  }
}
