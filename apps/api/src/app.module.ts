import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';
import { buildPinoHttpOptions } from './common/logging/logger.options.js';
import { EnvModule } from './config/env.js';
import { HealthModule } from './health/health.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { OpenapiModule } from './openapi/openapi.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { RedisModule } from './redis/redis.module.js';

@Module({
  imports: [
    EnvModule,
    LoggerModule.forRoot({ pinoHttp: buildPinoHttpOptions() }),
    PrismaModule,
    RedisModule,
    HealthModule,
    AuthModule,
    OpenapiModule,
  ],
  providers: [{ provide: APP_FILTER, useClass: AllExceptionsFilter }],
})
export class AppModule {}
