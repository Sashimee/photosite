import { Global, Module } from '@nestjs/common';
import { EmailQueueService } from './email-queue.service.js';

@Global()
@Module({
  providers: [EmailQueueService],
  exports: [EmailQueueService],
})
export class EmailQueueModule {}
