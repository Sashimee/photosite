import type { FastifyRequest } from 'fastify';

// Node folds a repeated `user-agent` header into one comma-joined string
// rather than an array (unlike `set-cookie`), so `IncomingHttpHeaders`
// types it as `string | undefined` - no array case to handle here.
export function userAgentHeader(request: FastifyRequest): string | undefined {
  return request.headers['user-agent'];
}
