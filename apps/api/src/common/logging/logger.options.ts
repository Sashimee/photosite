import { randomUUID } from 'node:crypto';
import type { Options } from 'pino-http';

export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["set-cookie"]',
  'res.headers["set-cookie"]',
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
];

export const REDACT_CENSOR = '[Redacted]';

export function buildPinoHttpOptions(): Options {
  return {
    level: process.env.NODE_ENV === 'test' ? 'silent' : 'info',
    genReqId: (request: unknown) => {
      const { id, raw } = request as { id?: unknown; raw?: { id?: unknown } };
      const requestId = id ?? raw?.id;
      return typeof requestId === 'string' && requestId.length > 0 ? requestId : randomUUID();
    },
    redact: {
      paths: REDACT_PATHS,
      censor: REDACT_CENSOR,
    },
  };
}
