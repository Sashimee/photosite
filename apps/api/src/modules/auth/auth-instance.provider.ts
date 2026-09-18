import type { Provider } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { RedisRateLimiter } from '../../common/rate-limit/redis-rate-limiter.js';
import { APP_CONFIG, type Env } from '../../config/env.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ChatSocketBridge } from '../chat/chat-socket-bridge.js';
import { buildAuth, type Auth } from './auth-instance.js';
import { EmailQueueService } from './mailer/email-queue.service.js';

export const AUTH_INSTANCE = Symbol('AUTH_INSTANCE');

export const authInstanceProvider: Provider = {
  provide: AUTH_INSTANCE,
  useFactory: (
    config: Env,
    prisma: PrismaService,
    rateLimiter: RedisRateLimiter,
    emailQueue: EmailQueueService,
    chatSocketBridge: ChatSocketBridge,
    logger: Logger,
  ): Auth =>
    buildAuth({ config, prisma: prisma.client, rateLimiter, emailQueue, chatSocketBridge, logger }),
  inject: [
    APP_CONFIG,
    PrismaService,
    RedisRateLimiter,
    EmailQueueService,
    ChatSocketBridge,
    Logger,
  ],
};
