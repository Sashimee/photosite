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
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  AdminBookingsExportQuerySchema,
  AdminBookingsQuerySchema,
  IdSchema,
  RefundBookingRequestSchema,
  ReverseBookingTransferRequestSchema,
} from '@photoo/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { AdminAccessService } from '../admin/admin-access.service.js';
import { AdminMutationRateLimitService } from '../admin/admin-mutation-rate-limit.service.js';
import { FetchOnlyGuard } from '../auth/fetch-only-guard.js';
import { OriginGuard } from '../auth/origin-guard.js';
import { AdminBookingsService } from './admin-bookings.service.js';
import { BookingRefundService } from './booking-refund.service.js';

const REQUIRES_2FA = { requires2fa: true } as const;

@Controller('admin/bookings')
@UseGuards(OriginGuard)
export class AdminBookingsController {
  constructor(
    @Inject(AdminAccessService) private readonly adminAccess: AdminAccessService,
    @Inject(AdminBookingsService) private readonly adminBookings: AdminBookingsService,
    @Inject(BookingRefundService) private readonly refunds: BookingRefundService,
    @Inject(AdminMutationRateLimitService)
    private readonly rateLimit: AdminMutationRateLimitService,
  ) {}

  @Get()
  async list(
    @Query(new ZodValidationPipe(AdminBookingsQuerySchema))
    query: ReturnType<(typeof AdminBookingsQuerySchema)['parse']>,
    @Req() request: FastifyRequest,
  ) {
    await this.adminAccess.requirePermission(request, 'finance');
    return this.adminBookings.list(query);
  }

  @Get('export.csv')
  @UseGuards(FetchOnlyGuard)
  async export(
    @Query(new ZodValidationPipe(AdminBookingsExportQuerySchema))
    query: ReturnType<(typeof AdminBookingsExportQuerySchema)['parse']>,
    @Req() request: FastifyRequest,
    @Res({ passthrough: false }) reply: FastifyReply,
  ): Promise<void> {
    const { user } = await this.adminAccess.requirePermission(request, 'finance', REQUIRES_2FA);
    await this.rateLimit.enforceExport(user.id);
    const { filename, body } = await this.adminBookings.exportCsv(user, query, request.ip);
    reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .header('Cache-Control', 'no-store')
      .send(body);
  }

  @Get(':id')
  async get(
    @Param('id', new ZodValidationPipe(IdSchema)) id: string,
    @Req() request: FastifyRequest,
  ) {
    await this.adminAccess.requirePermission(request, 'finance');
    return this.adminBookings.get(id);
  }

  @HttpCode(200)
  @Post(':id/refund')
  async refund(
    @Param('id', new ZodValidationPipe(IdSchema)) id: string,
    @Body(new ZodValidationPipe(RefundBookingRequestSchema))
    body: ReturnType<(typeof RefundBookingRequestSchema)['parse']>,
    @Req() request: FastifyRequest,
  ) {
    const { user } = await this.adminAccess.requirePermission(request, 'finance', REQUIRES_2FA);
    await this.rateLimit.enforce(user.id);
    await this.rateLimit.enforceMoney(user.id);
    return this.refunds.refundAsAdmin(user, id, body, request.ip);
  }

  @HttpCode(200)
  @Post(':id/reverse-transfer')
  async reverseTransfer(
    @Param('id', new ZodValidationPipe(IdSchema)) id: string,
    @Body(new ZodValidationPipe(ReverseBookingTransferRequestSchema))
    body: ReturnType<(typeof ReverseBookingTransferRequestSchema)['parse']>,
    @Req() request: FastifyRequest,
  ) {
    const { user } = await this.adminAccess.requirePermission(request, 'finance', REQUIRES_2FA);
    await this.rateLimit.enforce(user.id);
    await this.rateLimit.enforceMoney(user.id);
    return this.refunds.reverseTransferAsAdmin(user, id, body, request.ip);
  }
}
