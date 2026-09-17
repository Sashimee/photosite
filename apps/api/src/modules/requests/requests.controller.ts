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
  CreateRequestRequestSchema,
  CursorPaginationQuerySchema,
  IdSchema,
  RequestFeedQuerySchema,
} from '@photoo/shared';
import type { FastifyRequest } from 'fastify';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { AUTH_INSTANCE } from '../auth/auth-instance.provider.js';
import type { Auth } from '../auth/auth-instance.js';
import { OriginGuard } from '../auth/origin-guard.js';
import { requireSession } from '../auth/session.js';
import { RequestsService } from './requests.service.js';

@Controller('requests')
@UseGuards(OriginGuard)
export class RequestsController {
  constructor(
    @Inject(AUTH_INSTANCE) private readonly auth: Auth,
    @Inject(RequestsService) private readonly requests: RequestsService,
  ) {}

  @Post()
  async create(
    @Body(new ZodValidationPipe(CreateRequestRequestSchema))
    body: ReturnType<(typeof CreateRequestRequestSchema)['parse']>,
    @Req() request: FastifyRequest,
  ) {
    const { user } = await requireSession(this.auth, request);
    return this.requests.create(user, body, request.ip);
  }

  @Get()
  async feed(
    @Query(new ZodValidationPipe(RequestFeedQuerySchema))
    query: ReturnType<(typeof RequestFeedQuerySchema)['parse']>,
    @Req() request: FastifyRequest,
  ) {
    const { user } = await requireSession(this.auth, request);
    return this.requests.feed(user, query);
  }

  @Get('mine')
  async mine(
    @Query(new ZodValidationPipe(CursorPaginationQuerySchema))
    query: ReturnType<(typeof CursorPaginationQuerySchema)['parse']>,
    @Req() request: FastifyRequest,
  ) {
    const { user } = await requireSession(this.auth, request);
    return this.requests.mine(user, query);
  }

  @Get(':id')
  async get(
    @Param('id', new ZodValidationPipe(IdSchema)) id: string,
    @Req() request: FastifyRequest,
  ) {
    const { user } = await requireSession(this.auth, request);
    return this.requests.get(user, id);
  }

  @HttpCode(200)
  @Post(':id/cancel')
  async cancel(
    @Param('id', new ZodValidationPipe(IdSchema)) id: string,
    @Req() request: FastifyRequest,
  ) {
    const { user } = await requireSession(this.auth, request);
    return this.requests.cancel(user, id);
  }
}
