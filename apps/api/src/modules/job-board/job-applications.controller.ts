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
  CursorPaginationQuerySchema,
  IdSchema,
  UpdateJobApplicationStatusRequestSchema,
} from '@photoo/shared';
import type { FastifyRequest } from 'fastify';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { AUTH_INSTANCE } from '../auth/auth-instance.provider.js';
import type { Auth } from '../auth/auth-instance.js';
import { OriginGuard } from '../auth/origin-guard.js';
import { requireSession } from '../auth/session.js';
import { JobApplicationsService } from './job-applications.service.js';

@Controller()
@UseGuards(OriginGuard)
export class JobApplicationsController {
  constructor(
    @Inject(AUTH_INSTANCE) private readonly auth: Auth,
    @Inject(JobApplicationsService) private readonly jobApplications: JobApplicationsService,
  ) {}

  @Get('me/job-applications')
  async listMine(
    @Query(new ZodValidationPipe(CursorPaginationQuerySchema))
    query: ReturnType<(typeof CursorPaginationQuerySchema)['parse']>,
    @Req() request: FastifyRequest,
  ) {
    const { user } = await requireSession(this.auth, request);
    return this.jobApplications.listMine(user, query);
  }

  @HttpCode(200)
  @Post('job-applications/:id/status')
  async updateStatus(
    @Param('id', new ZodValidationPipe(IdSchema)) id: string,
    @Body(new ZodValidationPipe(UpdateJobApplicationStatusRequestSchema))
    body: ReturnType<(typeof UpdateJobApplicationStatusRequestSchema)['parse']>,
    @Req() request: FastifyRequest,
  ) {
    const { user } = await requireSession(this.auth, request);
    return this.jobApplications.updateStatus(user, id, body);
  }
}
