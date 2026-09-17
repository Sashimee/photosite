import { Body, Controller, Get, Inject, Put, Req, UseGuards } from '@nestjs/common';
import { UpdateNotificationPreferencesRequestSchema } from '@photoo/shared';
import type { FastifyRequest } from 'fastify';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { AUTH_INSTANCE } from '../auth/auth-instance.provider.js';
import type { Auth } from '../auth/auth-instance.js';
import { OriginGuard } from '../auth/origin-guard.js';
import { requireSession } from '../auth/session.js';
import { NotificationsService } from './notifications.service.js';

@Controller('me/notification-preferences')
@UseGuards(OriginGuard)
export class NotificationPreferencesController {
  constructor(
    @Inject(AUTH_INSTANCE) private readonly auth: Auth,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
  ) {}

  @Get()
  async get(@Req() request: FastifyRequest) {
    const { user } = await requireSession(this.auth, request);
    return this.notifications.getPreferences(user);
  }

  @Put()
  async update(
    @Body(new ZodValidationPipe(UpdateNotificationPreferencesRequestSchema))
    body: ReturnType<(typeof UpdateNotificationPreferencesRequestSchema)['parse']>,
    @Req() request: FastifyRequest,
  ) {
    const { user } = await requireSession(this.auth, request);
    return this.notifications.updatePreferences(user, body);
  }
}
