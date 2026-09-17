import {
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
import { IdSchema, NotificationsQuerySchema } from '@photoo/shared';
import type { FastifyRequest } from 'fastify';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { AUTH_INSTANCE } from '../auth/auth-instance.provider.js';
import type { Auth } from '../auth/auth-instance.js';
import { OriginGuard } from '../auth/origin-guard.js';
import { requireSession } from '../auth/session.js';
import { NotificationsService } from './notifications.service.js';

@Controller('notifications')
@UseGuards(OriginGuard)
export class NotificationsController {
  constructor(
    @Inject(AUTH_INSTANCE) private readonly auth: Auth,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
  ) {}

  @Get()
  async list(
    @Query(new ZodValidationPipe(NotificationsQuerySchema))
    query: ReturnType<(typeof NotificationsQuerySchema)['parse']>,
    @Req() request: FastifyRequest,
  ) {
    const { user } = await requireSession(this.auth, request);
    return this.notifications.list(user, query);
  }

  @Get('unread-count')
  async unreadCount(@Req() request: FastifyRequest) {
    const { user } = await requireSession(this.auth, request);
    return this.notifications.unreadCount(user);
  }

  @HttpCode(200)
  @Post(':id/read')
  async markRead(
    @Param('id', new ZodValidationPipe(IdSchema)) id: string,
    @Req() request: FastifyRequest,
  ) {
    const { user } = await requireSession(this.auth, request);
    return this.notifications.markRead(user, id);
  }

  @HttpCode(200)
  @Post('read-all')
  async markAllRead(@Req() request: FastifyRequest) {
    const { user } = await requireSession(this.auth, request);
    return this.notifications.markAllRead(user);
  }
}
