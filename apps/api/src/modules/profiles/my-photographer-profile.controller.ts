import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  AttachPortfolioImageRequestSchema,
  CreatePhotographerProfileRequestSchema,
  CursorPaginationQuerySchema,
  IdSchema,
  ReorderPortfolioRequestSchema,
  UpdatePhotographerProfileRequestSchema,
} from '@photoo/shared';
import type { FastifyRequest } from 'fastify';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { AUTH_INSTANCE } from '../auth/auth-instance.provider.js';
import type { Auth } from '../auth/auth-instance.js';
import { OriginGuard } from '../auth/origin-guard.js';
import { requireSession } from '../auth/session.js';
import { PortfolioService } from './portfolio.service.js';
import { ProfilesService } from './profiles.service.js';

@Controller('me/photographer-profile')
@UseGuards(OriginGuard)
export class MyPhotographerProfileController {
  constructor(
    @Inject(AUTH_INSTANCE) private readonly auth: Auth,
    @Inject(ProfilesService) private readonly profiles: ProfilesService,
    @Inject(PortfolioService) private readonly portfolio: PortfolioService,
  ) {}

  @Get()
  async getOwn(@Req() request: FastifyRequest) {
    const { user } = await requireSession(this.auth, request);
    return this.profiles.getOwn(user);
  }

  @Post()
  async create(
    @Body(new ZodValidationPipe(CreatePhotographerProfileRequestSchema))
    body: ReturnType<(typeof CreatePhotographerProfileRequestSchema)['parse']>,
    @Req() request: FastifyRequest,
  ) {
    const { user } = await requireSession(this.auth, request);
    return this.profiles.create(user, body);
  }

  @Patch()
  async update(
    @Body(new ZodValidationPipe(UpdatePhotographerProfileRequestSchema))
    body: ReturnType<(typeof UpdatePhotographerProfileRequestSchema)['parse']>,
    @Req() request: FastifyRequest,
  ) {
    const { user } = await requireSession(this.auth, request);
    return this.profiles.update(user, body);
  }

  @Get('portfolio')
  async listPortfolio(
    @Query(new ZodValidationPipe(CursorPaginationQuerySchema))
    query: ReturnType<(typeof CursorPaginationQuerySchema)['parse']>,
    @Req() request: FastifyRequest,
  ) {
    const { user } = await requireSession(this.auth, request);
    return this.portfolio.listOwn(user, query);
  }

  @Post('portfolio')
  async attachPortfolioImage(
    @Body(new ZodValidationPipe(AttachPortfolioImageRequestSchema))
    body: ReturnType<(typeof AttachPortfolioImageRequestSchema)['parse']>,
    @Req() request: FastifyRequest,
  ) {
    const { user } = await requireSession(this.auth, request);
    return this.portfolio.attach(user, body.uploadId);
  }

  @Patch('portfolio/order')
  async reorderPortfolio(
    @Body(new ZodValidationPipe(ReorderPortfolioRequestSchema))
    body: ReturnType<(typeof ReorderPortfolioRequestSchema)['parse']>,
    @Req() request: FastifyRequest,
  ) {
    const { user } = await requireSession(this.auth, request);
    const items = await this.portfolio.reorder(user, body.imageIds);
    return { items, nextCursor: null };
  }

  @HttpCode(204)
  @Delete('portfolio/:imageId')
  async deletePortfolioImage(
    @Param('imageId', new ZodValidationPipe(IdSchema)) imageId: string,
    @Req() request: FastifyRequest,
  ) {
    const { user } = await requireSession(this.auth, request);
    await this.portfolio.delete(user, imageId);
  }
}
