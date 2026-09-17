// Package entry point for apps/worker. The worker process itself boots via
// main.ts, not this file; this entry point exists only for the API's
// integration test harness (apps/api/src/testing/test-email-worker.module.ts),
// which reuses the real email processor and mail transport instead of
// re-implementing mail delivery for tests.
export {
  createEmailProcessor,
  type EmailProcessorDeps,
} from './queues/processors/email.processor.js';
export {
  createMailTransport,
  type MailTransport,
  type MailMessage,
  type MailTransportConfig,
} from './email/mail-transport.js';
