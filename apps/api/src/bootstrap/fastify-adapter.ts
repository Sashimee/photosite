import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { BODY_LIMIT_BYTES, REQUEST_ID_HEADER } from '../common/constants.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createFastifyAdapter(): FastifyAdapter {
  return new FastifyAdapter({
    bodyLimit: BODY_LIMIT_BYTES,
    genReqId: (request: IncomingMessage) => {
      const header = request.headers[REQUEST_ID_HEADER];
      const value = Array.isArray(header) ? header[0] : header;
      return typeof value === 'string' && UUID_REGEX.test(value) ? value : randomUUID();
    },
  });
}
