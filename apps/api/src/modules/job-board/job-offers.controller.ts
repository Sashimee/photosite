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
  CreateJobApplicationRequestSchema,
  CreateJobOfferRequestSchema,
  CursorPaginationQuerySchema,
  IdSchema,
  JobOffersQuerySchema,
  SlugSchema,
  UpdateJobOfferRequestSchema,
} from '@photoo/shared';
import type { FastifyRequest } from 'fastify';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { AUTH_INSTANCE } from '../auth/auth-instance.provider.js';
import type { Auth } from '../auth/auth-instance.js';
import { OriginGuard } from '../auth/origin-guard.js';
import { requireSession } from '../auth/session.js';
import { JobApplicationsService } from './job-applications.service.js';
import { JobOffersService } from './job-offers.service.js';

@Controller()
@UseGuards(OriginGuard)
export class JobOffersController {
  constructor(
    @Inject(AUTH_INSTANCE) private readonly auth: Auth,
    @Inject(JobOffersService) private readonly jobOffers: JobOffersService,
    @Inject(JobApplicationsService) private readonly jobApplications: JobApplicationsService,
  ) {}

  @Get('job-offers')
  async listPublic(
    @Query(new ZodValidationPipe(JobOffersQuerySchema))
    query: ReturnType<(typeof JobOffersQuerySchema)['parse']>,
  ) {
    return this.jobOffers.listPublic(query);
  }

  @Get('job-offers/:slug')
  async getPublicBySlug(@Param('slug', new ZodValidationPipe(SlugSchema)) slug: string) {
    return this.jobOffers.getPublicBySlug(slug);
  }

  @Post('me/job-offers')
  async create(
    @Body(new ZodValidationPipe(CreateJobOfferRequestSchema))
    body: ReturnType<(typeof CreateJobOfferRequestSchema)['parse']>,
    @Req() request: FastifyRequest,
  ) {
    const { user } = await requireSession(this.auth, request);
    return this.jobOffers.create(user, body);
  }

  @Get('me/job-offers')
  async listOwn(
    @Query(new ZodValidationPipe(CursorPaginationQuerySchema))
    query: ReturnType<(typeof CursorPaginationQuerySchema)['parse']>,
    @Req() request: FastifyRequest,
  ) {
    const { user } = await requireSession(this.auth, request);
    return this.jobOffers.listOwn(user, query);
  }

  @Get('me/job-offers/:id')
  async getOwn(
    @Param('id', new ZodValidationPipe(IdSchema)) id: string,
    @Req() request: FastifyRequest,
  ) {
    const { user } = await requireSession(this.auth, request);
    return this.jobOffers.getOwn(user, id);
  }

  @Patch('me/job-offers/:id')
  async update(
    @Param('id', new ZodValidationPipe(IdSchema)) id: string,
    @Body(new ZodValidationPipe(UpdateJobOfferRequestSchema))
    body: ReturnType<(typeof UpdateJobOfferRequestSchema)['parse']>,
    @Req() request: FastifyRequest,
  ) {
    const { user } = await requireSession(this.auth, request);
    return this.jobOffers.update(user, id, body);
  }

  @HttpCode(204)
  @Delete('me/job-offers/:id')
  async delete(
    @Param('id', new ZodValidationPipe(IdSchema)) id: string,
    @Req() request: FastifyRequest,
  ) {
    const { user } = await requireSession(this.auth, request);
    await this.jobOffers.delete(user, id);
  }

  @HttpCode(200)
  @Post('me/job-offers/:id/publish')
  async publish(
    @Param('id', new ZodValidationPipe(IdSchema)) id: string,
    @Req() request: FastifyRequest,
  ) {
    const { user } = await requireSession(this.auth, request);
    return this.jobOffers.publish(user, id);
  }

  @HttpCode(200)
  @Post('me/job-offers/:id/close')
  async close(
    @Param('id', new ZodValidationPipe(IdSchema)) id: string,
    @Req() request: FastifyRequest,
  ) {
    const { user } = await requireSession(this.auth, request);
    return this.jobOffers.close(user, id);
  }

  @Post('job-offers/:id/applications')
  async apply(
    @Param('id', new ZodValidationPipe(IdSchema)) id: string,
    @Body(new ZodValidationPipe(CreateJobApplicationRequestSchema))
    body: ReturnType<(typeof CreateJobApplicationRequestSchema)['parse']>,
    @Req() request: FastifyRequest,
  ) {
    const { user } = await requireSession(this.auth, request);
    return this.jobApplications.apply(user, id, body);
  }

  @Get('job-offers/:id/applications')
  async listApplications(
    @Param('id', new ZodValidationPipe(IdSchema)) id: string,
    @Query(new ZodValidationPipe(CursorPaginationQuerySchema))
    query: ReturnType<(typeof CursorPaginationQuerySchema)['parse']>,
    @Req() request: FastifyRequest,
  ) {
    const { user } = await requireSession(this.auth, request);
    return this.jobApplications.listReceived(user, id, query);
  }
}
