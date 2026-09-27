import { Body, Controller, HttpCode, Inject, Param, Post, Req, UseGuards } from '@nestjs/common';
import { CreateRefundRequestSchema, IdSchema } from '@photoo/shared';
import type { FastifyRequest } from 'fastify';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { AUTH_INSTANCE } from '../auth/auth-instance.provider.js';
import type { Auth } from '../auth/auth-instance.js';
import { OriginGuard } from '../auth/origin-guard.js';
import { requireSession } from '../auth/session.js';
import { BookingPaymentsService } from './booking-payments.service.js';
import { BookingRefundService } from './booking-refund.service.js';
import { PaymentsRateLimitService } from './payments-rate-limit.service.js';

@Controller('bookings')
@UseGuards(OriginGuard)
export class BookingPaymentsController {
  constructor(
    @Inject(AUTH_INSTANCE) private readonly auth: Auth,
    @Inject(BookingPaymentsService) private readonly payments: BookingPaymentsService,
    @Inject(BookingRefundService) private readonly refunds: BookingRefundService,
    @Inject(PaymentsRateLimitService) private readonly rateLimit: PaymentsRateLimitService,
  ) {}

  @HttpCode(200)
  @Post(':id/payment-intent')
  async createPaymentIntent(
    @Req() request: FastifyRequest,
    @Param('id', new ZodValidationPipe(IdSchema)) id: string,
  ) {
    const { user } = await requireSession(this.auth, request);
    return this.payments.createPaymentIntent(user, id);
  }

  @HttpCode(200)
  @Post(':id/refund')
  async refund(
    @Req() request: FastifyRequest,
    @Param('id', new ZodValidationPipe(IdSchema)) id: string,
    @Body(new ZodValidationPipe(CreateRefundRequestSchema))
    body: ReturnType<(typeof CreateRefundRequestSchema)['parse']>,
  ) {
    const { user } = await requireSession(this.auth, request);
    await this.rateLimit.enforceRefund(user.id);
    return this.refunds.refundAsClient(user, id, body, request.ip);
  }
}
