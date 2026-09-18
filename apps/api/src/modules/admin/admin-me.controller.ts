import { Controller, Get, Inject, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { OriginGuard } from '../auth/origin-guard.js';
import { AdminAccessService } from './admin-access.service.js';
import { AdminMeService } from './admin-me.service.js';

@Controller('admin/me')
@UseGuards(OriginGuard)
export class AdminMeController {
  constructor(
    @Inject(AdminAccessService) private readonly adminAccess: AdminAccessService,
    @Inject(AdminMeService) private readonly adminMe: AdminMeService,
  ) {}

  @Get()
  async get(@Req() request: FastifyRequest) {
    const session = await this.adminAccess.requireSession(request);
    return this.adminMe.get(session);
  }
}
