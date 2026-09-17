import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { AuditLogModule } from './common/audit-log.module.js';
import { buildPinoOptions } from './common/logging/logger.options.js';
import { EnvModule } from './config/env.js';
import { HealthModule } from './health/health.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { QueueWorkersModule } from './queues/queue-workers.module.js';
import { RedisModule } from './redis/redis.module.js';
import { StorageModule } from './storage/storage.module.js';

@Module({
  imports: [
    EnvModule,
    LoggerModule.forRoot({ pinoHttp: buildPinoOptions() }),
    PrismaModule,
    RedisModule,
    StorageModule,
    AuditLogModule,
    HealthModule,
    QueueWorkersModule,
  ],
})
export class AppModule {}
