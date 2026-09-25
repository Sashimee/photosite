import { Controller, Get, Inject, Param, Query, Req, UseGuards } from '@nestjs/common';
import { AdminEmailTemplatePreviewQuerySchema, EmailTemplateNameSchema } from '@photoo/shared';
import type { FastifyRequest } from 'fastify';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { OriginGuard } from '../auth/origin-guard.js';
import { AdminAccessService } from './admin-access.service.js';
import { AdminEmailTemplatesService } from './admin-email-templates.service.js';

@Controller('admin/email-templates')
@UseGuards(OriginGuard)
export class AdminEmailTemplatesController {
  constructor(
    @Inject(AdminAccessService) private readonly adminAccess: AdminAccessService,
    @Inject(AdminEmailTemplatesService)
    private readonly adminEmailTemplates: AdminEmailTemplatesService,
  ) {}

  @Get()
  async list(@Req() request: FastifyRequest) {
    await this.adminAccess.requirePermission(request, 'superadmin');
    return this.adminEmailTemplates.list();
  }

  @Get(':template/preview')
  async preview(
    @Param('template', new ZodValidationPipe(EmailTemplateNameSchema))
    template: ReturnType<(typeof EmailTemplateNameSchema)['parse']>,
    @Query(new ZodValidationPipe(AdminEmailTemplatePreviewQuerySchema))
    query: ReturnType<(typeof AdminEmailTemplatePreviewQuerySchema)['parse']>,
    @Req() request: FastifyRequest,
  ) {
    await this.adminAccess.requirePermission(request, 'superadmin');
    return this.adminEmailTemplates.preview(template, query.locale);
  }
}
