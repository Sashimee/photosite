import { Controller, Get, Inject, Param, Query, Req } from '@nestjs/common';
import { PhotographerSearchQuerySchema, SlugSchema } from '@photoo/shared';
import type { FastifyRequest } from 'fastify';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { ProfilesService } from './profiles.service.js';

@Controller('photographers')
export class PhotographersController {
  constructor(@Inject(ProfilesService) private readonly profiles: ProfilesService) {}

  @Get()
  async search(
    @Query(new ZodValidationPipe(PhotographerSearchQuerySchema))
    query: ReturnType<(typeof PhotographerSearchQuerySchema)['parse']>,
    @Req() request: FastifyRequest,
  ) {
    return this.profiles.search(query, request.ip);
  }

  @Get(':slug')
  async getBySlug(@Param('slug', new ZodValidationPipe(SlugSchema)) slug: string) {
    return this.profiles.getPublicBySlug(slug);
  }
}
