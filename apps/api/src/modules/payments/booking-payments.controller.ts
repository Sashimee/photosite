import { Controller, HttpCode, Inject, Param, Post, Req, UseGuards } from '@nestjs/common';
import { IdSchema } from '@photoo/shared';
import type { FastifyRequest } from 'fastify';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { AUTH_INSTANCE } from '../auth/auth-instance.provider.js';
import type { Auth } from '../auth/auth-instance.js';
import { OriginGuard } from '../auth/origin-guard.js';
import { requireSession } from '../auth/session.js';
import { BookingPaymentsService } from './booking-payments.service.js';

@Controller('bookings')
@UseGuards(OriginGuard)
export class BookingPaymentsController {
  constructor(
    @Inject(AUTH_INSTANCE) private readonly auth: Auth,
    @Inject(BookingPaymentsService) private readonly payments: BookingPaymentsService,
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
}
