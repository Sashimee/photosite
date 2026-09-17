import type { OnModuleInit } from '@nestjs/common';
import { Inject, Module } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { FastifyInstance } from 'fastify';
import { AuditLogModule } from '../../common/audit/audit-log.module.js';
import { RateLimitModule } from '../../common/rate-limit/rate-limit.module.js';
import { APP_CONFIG, type Env } from '../../config/env.js';
import { AUTH_INSTANCE, authInstanceProvider } from './auth-instance.provider.js';
import type { Auth } from './auth-instance.js';
import { AuthController } from './auth.controller.js';
import { AuthRateLimitService } from './auth-rate-limit.service.js';
import { EmailQueueModule } from './mailer/email-queue.module.js';
import { mountOAuthCallback } from './oauth-callback.js';
import { OriginGuard } from './origin-guard.js';

@Module({
  imports: [AuditLogModule, RateLimitModule, EmailQueueModule],
  controllers: [AuthController],
  providers: [authInstanceProvider, AuthRateLimitService, OriginGuard],
  exports: [authInstanceProvider],
})
export class AuthModule implements OnModuleInit {
  constructor(
    @Inject(HttpAdapterHost) private readonly adapterHost: HttpAdapterHost,
    @Inject(AUTH_INSTANCE) private readonly auth: Auth,
    @Inject(APP_CONFIG) private readonly config: Env,
  ) {}

  onModuleInit(): void {
    const fastify = this.adapterHost.httpAdapter.getInstance<FastifyInstance>();
    mountOAuthCallback(fastify, this.auth, this.config);
  }
}
