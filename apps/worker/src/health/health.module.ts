import { Module } from '@nestjs/common';
import { HealthServerService } from './health-server.service.js';
import { HealthService } from './health.service.js';

@Module({
  providers: [HealthService, HealthServerService],
  exports: [HealthService],
})
export class HealthModule {}
