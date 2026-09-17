import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Options } from 'pino-http';

export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["set-cookie"]',
  'res.headers["set-cookie"]',
  'res.headers["set-auth-token"]',
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
  // Not a bare `*.url`/`*.otpauthUrl`: pino's `*` wildcard matches one level
  // under any object, which would also swallow `req.url` (the serializer
  // below already strips its query string and masks reset tokens, and it
  // needs to stay readable for ops). `body.*`/`err.*` cover the payload
  // shapes that could carry a verification/reset link or an otpauth URI.
  'body.url',
  'body.otpauthUrl',
  'err.url',
  'err.otpauthUrl',
  // Presigned S3 PUT/GET URLs are bearer credentials (SECURITY.md "Logs...
  // never log presigned URLs"): the uploads response bodies carry them as
  // `url`, already covered by `body.url` above, plus a defensive
  // `presignedUrl` in case a future log call names the field directly.
  '*.presignedUrl',
  'presignedUrl',
];

export const REDACT_CENSOR = '[Redacted]';

// Verification and password-reset tokens travel as a query string / path
// segment on the auth routes; pino-http's default req serializer logs the
// full req.url, which would put a live, single-use token in every log
// shipper and Sentry breadcrumb. Strip the query string and mask any
// `/reset-password/<token>` path segment before the line is ever written.
export function sanitizeLoggedUrl(rawUrl: string): string {
  const [pathname = rawUrl] = rawUrl.split('?');
  return pathname.replace(/\/reset-password\/[^/?]+/, '/reset-password/[Redacted]');
}

function serializeRequest(req: IncomingMessage): Record<string, unknown> {
  // `req.socket` is typed as always present, but Fastify's `.inject()` (used
  // by every test in this repo) passes a synthetic request with no real
  // socket, so this must tolerate it being absent at runtime.
  const socket = req.socket as { remoteAddress?: string; remotePort?: number } | undefined;
  return {
    id: req.id,
    method: req.method,
    url: sanitizeLoggedUrl(req.url ?? ''),
    headers: req.headers,
    remoteAddress: socket?.remoteAddress,
    remotePort: socket?.remotePort,
  };
}

export function buildPinoHttpOptions(): Options {
  return {
    level: process.env.NODE_ENV === 'test' ? 'silent' : 'info',
    genReqId: (request: unknown) => {
      const { id, raw } = request as { id?: unknown; raw?: { id?: unknown } };
      const requestId = id ?? raw?.id;
      return typeof requestId === 'string' && requestId.length > 0 ? requestId : randomUUID();
    },
    serializers: {
      req: serializeRequest,
    },
    redact: {
      paths: REDACT_PATHS,
      censor: REDACT_CENSOR,
    },
  };
}
