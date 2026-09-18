import { Body, Controller, HttpCode, Inject, Post, Req, UseGuards } from '@nestjs/common';
import { CreateReportRequestSchema, type CreateReportResponseSchema } from '@photoo/shared';
import type { FastifyRequest } from 'fastify';
import type { z } from 'zod';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { AUTH_INSTANCE } from '../auth/auth-instance.provider.js';
import type { Auth } from '../auth/auth-instance.js';
import { OriginGuard } from '../auth/origin-guard.js';
import { getOptionalSession } from '../auth/session.js';
import { ReportsService } from './reports.service.js';

@Controller('reports')
@UseGuards(OriginGuard)
export class ReportsController {
  constructor(
    @Inject(AUTH_INSTANCE) private readonly auth: Auth,
    @Inject(ReportsService) private readonly reports: ReportsService,
  ) {}

  @HttpCode(201)
  @Post()
  async create(
    @Body(new ZodValidationPipe(CreateReportRequestSchema))
    body: ReturnType<(typeof CreateReportRequestSchema)['parse']>,
    @Req() request: FastifyRequest,
  ): Promise<z.infer<typeof CreateReportResponseSchema>> {
    const session = await getOptionalSession(this.auth, request);
    await this.reports.create(body, session?.user.id ?? null, request.ip);
    return { status: 'received' };
  }
}
