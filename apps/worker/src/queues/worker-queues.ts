import {
  FILE_SCAN_QUEUE_NAME,
  IMAGE_PROCESS_QUEUE_NAME,
  UPLOADS_CLEANUP_QUEUE_NAME,
} from '@photoo/shared';

// The 'email' queue is deliberately excluded: apps/api's dev-only Mailpit
// consumer (mailer/dev-mail-worker.ts) still owns it until 1A.7 replaces it
// with a real Brevo consumer here.
export const WORKER_QUEUE_NAMES = [
  FILE_SCAN_QUEUE_NAME,
  IMAGE_PROCESS_QUEUE_NAME,
  UPLOADS_CLEANUP_QUEUE_NAME,
] as const;

export type WorkerQueueName = (typeof WORKER_QUEUE_NAMES)[number];
