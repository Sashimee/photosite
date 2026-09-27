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
  CancelBookingRequestSchema,
  CreateDeliveryRequestSchema,
  CursorPaginationQuerySchema,
  IdSchema,
} from '@photoo/shared';
import type { FastifyRequest } from 'fastify';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { AUTH_INSTANCE } from '../auth/auth-instance.provider.js';
import type { Auth } from '../auth/auth-instance.js';
import { OriginGuard } from '../auth/origin-guard.js';
import { requireSession } from '../auth/session.js';
import { BookingsService } from './bookings.service.js';

@Controller('bookings')
@UseGuards(OriginGuard)
export class BookingsController {
  constructor(
    @Inject(AUTH_INSTANCE) private readonly auth: Auth,
    @Inject(BookingsService) private readonly bookings: BookingsService,
  ) {}

  @Get()
  async list(
    @Req() request: FastifyRequest,
    @Query(new ZodValidationPipe(CursorPaginationQuerySchema))
    query: ReturnType<(typeof CursorPaginationQuerySchema)['parse']>,
  ) {
    const { user } = await requireSession(this.auth, request);
    return this.bookings.list(user, query);
  }

  @Get(':id')
  async get(
    @Req() request: FastifyRequest,
    @Param('id', new ZodValidationPipe(IdSchema)) id: string,
  ) {
    const { user } = await requireSession(this.auth, request);
    return this.bookings.get(user, id);
  }

  @HttpCode(201)
  @Post(':id/delivery')
  async createDelivery(
    @Req() request: FastifyRequest,
    @Param('id', new ZodValidationPipe(IdSchema)) id: string,
    @Body(new ZodValidationPipe(CreateDeliveryRequestSchema))
    body: ReturnType<(typeof CreateDeliveryRequestSchema)['parse']>,
  ) {
    const { user } = await requireSession(this.auth, request);
    return this.bookings.createDelivery(user, id, body, request.ip);
  }

  @HttpCode(200)
  @Post(':id/accept-delivery')
  async acceptDelivery(
    @Req() request: FastifyRequest,
    @Param('id', new ZodValidationPipe(IdSchema)) id: string,
  ) {
    const { user } = await requireSession(this.auth, request);
    return this.bookings.acceptDelivery(user, id, request.ip);
  }

  @HttpCode(200)
  @Post(':id/cancel')
  async cancel(
    @Req() request: FastifyRequest,
    @Param('id', new ZodValidationPipe(IdSchema)) id: string,
    @Body(new ZodValidationPipe(CancelBookingRequestSchema))
    body: ReturnType<(typeof CancelBookingRequestSchema)['parse']>,
  ) {
    const { user } = await requireSession(this.auth, request);
    return this.bookings.cancel(user, id, body, request.ip);
  }
}
