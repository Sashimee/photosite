import type { Options } from 'pino-http';
import { buildSensitiveKeyRedactPaths } from './redaction.js';

// Duplicated from apps/api/src/common/logging/logger.options.ts rather than
// shared from packages/shared: that package is also bundled into apps/web
// and apps/mobile, and pulling a pino-http dependency (and its req/res
// serializers) into a browser/React-Native bundle isn't clean. The worker
// has no inbound HTTP requests to log, so it only needs the redaction list,
// not the request serializer or URL sanitizer the API builds on top of it.
export const REDACT_PATHS = [
  ...buildSensitiveKeyRedactPaths(),
  '*.code',
  '*.backupCode',
  '*.backupCodes',
  '*.newPassword',
  '*.currentPassword',
  'body.url',
  'body.otpauthUrl',
  'err.url',
  'err.otpauthUrl',
  // nodemailer's SMTP error carries recipient addresses and the raw server
  // response in these fields.
  'err.rejected',
  'err.response',
  'err.envelope',
  'err.accepted',
  // ConsentRecord's `ip`/`userAgent` are stored as evidence of consent
  // (docs/steps/1A.12-gdpr.md "Consent records"), which makes them PII even
  // though neither is a secret.
  '*.ip',
  '*.userAgent',
  'ip',
  'userAgent',
];

export const REDACT_CENSOR = '[Redacted]';

export function buildPinoOptions(): Options {
  return {
    level: process.env.NODE_ENV === 'test' ? 'silent' : 'info',
    redact: {
      paths: REDACT_PATHS,
      censor: REDACT_CENSOR,
    },
  };
}
