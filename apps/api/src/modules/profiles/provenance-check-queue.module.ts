import { Module } from '@nestjs/common';
import { ProvenanceCheckQueueService } from './provenance-check-queue.service.js';

@Module({
  providers: [ProvenanceCheckQueueService],
  exports: [ProvenanceCheckQueueService],
})
export class ProvenanceCheckQueueModule {}
