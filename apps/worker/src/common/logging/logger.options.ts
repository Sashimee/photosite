import type { Options } from 'pino-http';

// Duplicated from apps/api/src/common/logging/logger.options.ts rather than
// shared from packages/shared: that package is also bundled into apps/web
// and apps/mobile, and pulling a pino-http dependency (and its req/res
// serializers) into a browser/React-Native bundle isn't clean. The worker
// has no inbound HTTP requests to log, so it only needs the redaction list,
// not the request serializer or URL sanitizer the API builds on top of it.
export const REDACT_PATHS = [
  'password',
  'token',
  'secret',
  'authorization',
  'cookie',
  '*.password',
  '*.token',
  '*.secret',
  '*.authorization',
  '*.cookie',
  '*.code',
  '*.backupCode',
  '*.backupCodes',
  '*.newPassword',
  '*.currentPassword',
  'body.url',
  'body.otpauthUrl',
  'err.url',
  'err.otpauthUrl',
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
