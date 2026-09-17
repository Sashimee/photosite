import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';
import { buildPinoHttpOptions } from './common/logging/logger.options.js';
import { RateLimitModule } from './common/rate-limit/rate-limit.module.js';
import { EnvModule } from './config/env.js';
import { HealthModule } from './health/health.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { CitiesModule } from './modules/cities/cities.module.js';
import { CountriesModule } from './modules/countries/countries.module.js';
import { NotificationsModule } from './modules/notifications/notifications.module.js';
import { ProductsModule } from './modules/products/products.module.js';
import { ProfilesModule } from './modules/profiles/profiles.module.js';
import { QuotesModule } from './modules/quotes/quotes.module.js';
import { RequestsModule } from './modules/requests/requests.module.js';
import { UploadsModule } from './modules/uploads/uploads.module.js';
import { OpenapiModule } from './openapi/openapi.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { RedisModule } from './redis/redis.module.js';
import { StorageModule } from './storage/storage.module.js';

@Module({
  imports: [
    EnvModule,
    LoggerModule.forRoot({ pinoHttp: buildPinoHttpOptions() }),
    PrismaModule,
    RedisModule,
    RateLimitModule,
    StorageModule,
    HealthModule,
    AuthModule,
    UploadsModule,
    ProfilesModule,
    ProductsModule,
    CitiesModule,
    CountriesModule,
    RequestsModule,
    QuotesModule,
    NotificationsModule,
    OpenapiModule,
  ],
  providers: [{ provide: APP_FILTER, useClass: AllExceptionsFilter }],
})
export class AppModule {}
