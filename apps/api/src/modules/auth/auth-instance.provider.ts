import type { Provider } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { APP_CONFIG, type Env } from '../../config/env.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { RedisService } from '../../redis/redis.service.js';
import { buildAuth, type Auth } from './auth-instance.js';
import { EmailQueueService } from './mailer/email-queue.service.js';

export const AUTH_INSTANCE = Symbol('AUTH_INSTANCE');

export const authInstanceProvider: Provider = {
  provide: AUTH_INSTANCE,
  useFactory: (
    config: Env,
    prisma: PrismaService,
    redis: RedisService,
    emailQueue: EmailQueueService,
    logger: Logger,
  ): Auth => buildAuth({ config, prisma: prisma.client, redis: redis.client, emailQueue, logger }),
  inject: [APP_CONFIG, PrismaService, RedisService, EmailQueueService, Logger],
};
