import * as Sentry from '@sentry/node';
import type { Env } from '../../config/env.js';
import { scrubEvent } from './scrub-event.js';

export function initSentry(env: Env): void {
  if (!env.SENTRY_DSN) {
    return;
  }
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.SENTRY_ENVIRONMENT ?? env.NODE_ENV,
    tracesSampleRate: env.SENTRY_TRACES_SAMPLE_RATE,
    sendDefaultPii: false,
    beforeSend: scrubEvent,
  });
}
