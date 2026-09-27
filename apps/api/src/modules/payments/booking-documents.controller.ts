import { Controller, Get, Inject, Param, Req, UseGuards } from '@nestjs/common';
import { BookingDocumentSchema, IdSchema, type BookingDocument } from '@photoo/shared';
import type { FastifyRequest } from 'fastify';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { AUTH_INSTANCE } from '../auth/auth-instance.provider.js';
import type { Auth } from '../auth/auth-instance.js';
import { OriginGuard } from '../auth/origin-guard.js';
import { requireSession } from '../auth/session.js';
import { BookingDocumentsService } from './booking-documents.service.js';

@Controller('bookings')
@UseGuards(OriginGuard)
export class BookingDocumentsController {
  constructor(
    @Inject(AUTH_INSTANCE) private readonly auth: Auth,
    @Inject(BookingDocumentsService) private readonly documents: BookingDocumentsService,
  ) {}

  @Get(':id/documents/:document')
  async download(
    @Req() request: FastifyRequest,
    @Param('id', new ZodValidationPipe(IdSchema)) id: string,
    @Param('document', new ZodValidationPipe(BookingDocumentSchema)) document: BookingDocument,
  ) {
    const { user } = await requireSession(this.auth, request);
    return this.documents.issueDownload(user, id, document);
  }
}
