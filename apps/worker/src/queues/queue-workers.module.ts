import { Module } from '@nestjs/common';
import { QueueWorkersService } from './queue-workers.service.js';

@Module({
  providers: [QueueWorkersService],
})
export class QueueWorkersModule {}
