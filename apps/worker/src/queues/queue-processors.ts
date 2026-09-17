import { QUEUE_JOB_SCHEMAS, type QueueJobPayload } from '@photoo/shared';
import type { Job, Processor } from 'bullmq';
import type { Logger } from 'nestjs-pino';
import type { WorkerQueueName } from './worker-queues.js';

// The real file.scan/image.process/uploads-cleanup logic lands in 1A.3b;
// for now each processor only validates the payload against the shared
// schema, so a malformed job fails loudly instead of completing silently.
export function createValidatingProcessor<Name extends WorkerQueueName>(
  queueName: Name,
  logger: Logger,
): Processor<QueueJobPayload<Name>> {
  const schema = QUEUE_JOB_SCHEMAS[queueName];

  // schema.parse throws synchronously; running it inside .then() turns that
  // into a rejected Promise<void> rather than a synchronous throw out of a
  // function typed to return a promise, without needing an async/await that
  // would otherwise have nothing to await.
  return (job: Job<QueueJobPayload<Name>>): Promise<void> =>
    Promise.resolve().then(() => {
      const payload = schema.parse(job.data) as QueueJobPayload<Name>;
      logger.log(
        { queue: queueName, jobId: job.id, uploadId: payload.uploadId },
        'received job; processing lands in 1A.3b',
      );
    });
}
