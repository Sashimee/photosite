import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  CountryCodeSchema,
  PublishLegalTextRequestSchema,
  UpdateCountryRequestSchema,
} from '@photoo/shared';
import type { FastifyRequest } from 'fastify';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { AdminAccessService } from '../admin/admin-access.service.js';
import { AdminMutationRateLimitService } from '../admin/admin-mutation-rate-limit.service.js';
import { OriginGuard } from '../auth/origin-guard.js';
import { AdminCountriesService } from './admin-countries.service.js';

@Controller('admin/countries')
@UseGuards(OriginGuard)
export class AdminCountriesController {
  constructor(
    @Inject(AdminAccessService) private readonly adminAccess: AdminAccessService,
    @Inject(AdminCountriesService) private readonly adminCountries: AdminCountriesService,
    @Inject(AdminMutationRateLimitService)
    private readonly rateLimit: AdminMutationRateLimitService,
  ) {}

  @Get()
  async list(@Req() request: FastifyRequest) {
    await this.adminAccess.requirePermission(request, 'superadmin');
    return this.adminCountries.list();
  }

  @Patch(':code')
  async update(
    @Param('code', new ZodValidationPipe(CountryCodeSchema)) code: string,
    @Body(new ZodValidationPipe(UpdateCountryRequestSchema))
    body: ReturnType<(typeof UpdateCountryRequestSchema)['parse']>,
    @Req() request: FastifyRequest,
  ) {
    const { user } = await this.adminAccess.requirePermission(request, 'superadmin');
    await this.rateLimit.enforce(user.id);
    return this.adminCountries.update(user, code, body, request.ip);
  }

  @Get(':code/legal-texts')
  async getLegalTexts(
    @Param('code', new ZodValidationPipe(CountryCodeSchema)) code: string,
    @Req() request: FastifyRequest,
  ) {
    await this.adminAccess.requirePermission(request, 'superadmin');
    return this.adminCountries.getLegalTexts(code);
  }

  @Post(':code/legal-texts')
  @HttpCode(201)
  async publishLegalText(
    @Param('code', new ZodValidationPipe(CountryCodeSchema)) code: string,
    @Body(new ZodValidationPipe(PublishLegalTextRequestSchema))
    body: ReturnType<(typeof PublishLegalTextRequestSchema)['parse']>,
    @Req() request: FastifyRequest,
  ) {
    const { user } = await this.adminAccess.requirePermission(request, 'superadmin');
    await this.rateLimit.enforce(user.id);
    return this.adminCountries.publishLegalText(user, code, body, request.ip);
  }
}
