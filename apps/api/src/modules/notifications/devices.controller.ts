import {
  Body,
  Controller,
  Delete,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { IdSchema, RegisterDeviceRequestSchema } from '@photoo/shared';
import type { FastifyRequest } from 'fastify';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { AUTH_INSTANCE } from '../auth/auth-instance.provider.js';
import type { Auth } from '../auth/auth-instance.js';
import { OriginGuard } from '../auth/origin-guard.js';
import { requireSession } from '../auth/session.js';
import { DevicesRateLimitService } from './devices-rate-limit.service.js';
import { NotificationsService } from './notifications.service.js';

@Controller('me/devices')
@UseGuards(OriginGuard)
export class DevicesController {
  constructor(
    @Inject(AUTH_INSTANCE) private readonly auth: Auth,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
    @Inject(DevicesRateLimitService) private readonly rateLimit: DevicesRateLimitService,
  ) {}

  @HttpCode(201)
  @Post()
  async register(
    @Body(new ZodValidationPipe(RegisterDeviceRequestSchema))
    body: ReturnType<(typeof RegisterDeviceRequestSchema)['parse']>,
    @Req() request: FastifyRequest,
  ) {
    const { user } = await requireSession(this.auth, request);
    await this.rateLimit.enforceRegister(user.id);
    return this.notifications.registerDevice(user, body);
  }

  @HttpCode(204)
  @Delete(':id')
  async remove(
    @Param('id', new ZodValidationPipe(IdSchema)) id: string,
    @Req() request: FastifyRequest,
  ) {
    const { user } = await requireSession(this.auth, request);
    await this.notifications.deleteDevice(user, id);
  }
}
