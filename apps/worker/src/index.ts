// Package entry point for apps/worker. Its only production consumer is
// main.ts (bootstrapping the Nest application context directly); the
// consumer of this entry point is the API's integration test harness, which
// reuses the real email processor and mail transport instead of
// re-implementing mail delivery for tests (docs/steps/1A.7-notifications.md).
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
