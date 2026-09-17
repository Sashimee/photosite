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
  CreateQuoteRequestSchema,
  CursorPaginationQuerySchema,
  DirectQuoteRequestSchema,
  IdSchema,
  QuotesMineQuerySchema,
  SlugSchema,
} from '@photoo/shared';
import type { FastifyRequest } from 'fastify';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { AUTH_INSTANCE } from '../auth/auth-instance.provider.js';
import type { Auth } from '../auth/auth-instance.js';
import { OriginGuard } from '../auth/origin-guard.js';
import { requireSession } from '../auth/session.js';
import { QuotesService } from './quotes.service.js';

@Controller()
@UseGuards(OriginGuard)
export class QuotesController {
  constructor(
    @Inject(AUTH_INSTANCE) private readonly auth: Auth,
    @Inject(QuotesService) private readonly quotes: QuotesService,
  ) {}

  @Post('quotes')
  async createForRequest(
    @Body(new ZodValidationPipe(CreateQuoteRequestSchema))
    body: ReturnType<(typeof CreateQuoteRequestSchema)['parse']>,
    @Req() request: FastifyRequest,
  ) {
    const { user } = await requireSession(this.auth, request);
    return this.quotes.createForRequest(user, body, request.ip);
  }

  @Post('photographers/:slug/products/:productId/quotes')
  async createDirect(
    @Param('slug', new ZodValidationPipe(SlugSchema)) slug: string,
    @Param('productId', new ZodValidationPipe(IdSchema)) productId: string,
    @Body(new ZodValidationPipe(DirectQuoteRequestSchema))
    body: ReturnType<(typeof DirectQuoteRequestSchema)['parse']>,
    @Req() request: FastifyRequest,
  ) {
    const { user } = await requireSession(this.auth, request);
    return this.quotes.createDirect(user, slug, productId, body, request.ip);
  }

  @Get('quotes/mine')
  async mine(
    @Query(new ZodValidationPipe(QuotesMineQuerySchema))
    query: ReturnType<(typeof QuotesMineQuerySchema)['parse']>,
    @Req() request: FastifyRequest,
  ) {
    const { user } = await requireSession(this.auth, request);
    return this.quotes.mine(user, query);
  }

  @Get('quotes/:id')
  async get(
    @Param('id', new ZodValidationPipe(IdSchema)) id: string,
    @Req() request: FastifyRequest,
  ) {
    const { user } = await requireSession(this.auth, request);
    return this.quotes.get(user, id);
  }

  @Get('requests/:requestId/quotes')
  async listForRequest(
    @Param('requestId', new ZodValidationPipe(IdSchema)) requestId: string,
    @Query(new ZodValidationPipe(CursorPaginationQuerySchema))
    query: ReturnType<(typeof CursorPaginationQuerySchema)['parse']>,
    @Req() request: FastifyRequest,
  ) {
    const { user } = await requireSession(this.auth, request);
    return this.quotes.listForRequest(user, requestId, query);
  }

  @HttpCode(200)
  @Post('quotes/:id/accept')
  async accept(
    @Param('id', new ZodValidationPipe(IdSchema)) id: string,
    @Req() request: FastifyRequest,
  ) {
    const { user } = await requireSession(this.auth, request);
    return this.quotes.accept(user, id);
  }

  @HttpCode(200)
  @Post('quotes/:id/decline')
  async decline(
    @Param('id', new ZodValidationPipe(IdSchema)) id: string,
    @Req() request: FastifyRequest,
  ) {
    const { user } = await requireSession(this.auth, request);
    return this.quotes.decline(user, id);
  }

  @HttpCode(200)
  @Post('quotes/:id/withdraw')
  async withdraw(
    @Param('id', new ZodValidationPipe(IdSchema)) id: string,
    @Req() request: FastifyRequest,
  ) {
    const { user } = await requireSession(this.auth, request);
    return this.quotes.withdraw(user, id);
  }
}
