import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  CancelDataRequestRequestSchema,
  CreateDataRequestRequestSchema,
  IdSchema,
} from '@photoo/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { AUTH_INSTANCE } from '../auth/auth-instance.provider.js';
import type { Auth } from '../auth/auth-instance.js';
import { OriginGuard } from '../auth/origin-guard.js';
import { getOptionalSession, requireSession } from '../auth/session.js';
import { DataRequestsService } from './data-requests.service.js';

@Controller('me/data-requests')
@UseGuards(OriginGuard)
export class DataRequestsController {
  constructor(
    @Inject(AUTH_INSTANCE) private readonly auth: Auth,
    @Inject(DataRequestsService) private readonly dataRequests: DataRequestsService,
  ) {}

  @Post()
  async create(
    @Body(new ZodValidationPipe(CreateDataRequestRequestSchema))
    body: ReturnType<(typeof CreateDataRequestRequestSchema)['parse']>,
    @Req() request: FastifyRequest,
    @Res({ passthrough: false }) reply: FastifyReply,
  ): Promise<void> {
    const { user } = await requireSession(this.auth, request);
    const result = await this.dataRequests.create(user, body, request.ip);
    reply.status(result.status);
    reply.send(result.data);
  }

  @Get()
  async list(@Req() request: FastifyRequest) {
    const { user } = await requireSession(this.auth, request);
    return this.dataRequests.list(user);
  }

  @Get(':id')
  async get(
    @Param('id', new ZodValidationPipe(IdSchema)) id: string,
    @Req() request: FastifyRequest,
  ) {
    const { user } = await requireSession(this.auth, request);
    return this.dataRequests.get(user, id);
  }

  // `getOptionalSession`, not `requireSession`: a soft-deleted account has
  // no session (docs/steps/1A.12-gdpr.md "Cancellable during the grace
  // period"), so `DataRequestsService.cancel` accepts `body.token` instead.
  @HttpCode(200)
  @Post(':id/cancel')
  async cancel(
    @Param('id', new ZodValidationPipe(IdSchema)) id: string,
    @Body(new ZodValidationPipe(CancelDataRequestRequestSchema))
    body: ReturnType<(typeof CancelDataRequestRequestSchema)['parse']>,
    @Req() request: FastifyRequest,
  ) {
    const session = await getOptionalSession(this.auth, request);
    return this.dataRequests.cancel(id, session?.user ?? null, body.token);
  }

  @Get(':id/download')
  async download(
    @Param('id', new ZodValidationPipe(IdSchema)) id: string,
    @Req() request: FastifyRequest,
  ) {
    const { user } = await requireSession(this.auth, request);
    return this.dataRequests.download(user, id);
  }
}
