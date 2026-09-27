import { Transform, type TransformCallback } from 'node:stream';
import type {
  FastifyInstance,
  FastifyRequest,
  preParsingAsyncHookHandler,
  RouteOptions,
} from 'fastify';

const rawBodies = new WeakMap<FastifyRequest, Buffer>();

const captureRawBody: preParsingAsyncHookHandler = (request, _reply, payload) => {
  const chunks: Buffer[] = [];
  const tee = new Transform({
    transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback) {
      chunks.push(chunk);
      callback(null, chunk);
    },
    flush(callback: TransformCallback) {
      rawBodies.set(request, Buffer.concat(chunks));
      callback();
    },
  });
  return Promise.resolve(payload.pipe(tee));
};

// Stripe signs the exact bytes it sent, so signature verification needs them
// untouched. Capturing only on the listed routes keeps every other route on the
// normal parser without an extra copy of each body in memory.
export function captureRawBodyOn(fastify: FastifyInstance, urls: readonly string[]): void {
  fastify.addHook('onRoute', (routeOptions: RouteOptions) => {
    if (!urls.includes(routeOptions.url)) {
      return;
    }
    const existing = routeOptions.preParsing;
    const hooks = existing === undefined ? [] : Array.isArray(existing) ? existing : [existing];
    routeOptions.preParsing = [...hooks, captureRawBody];
  });
}

export function getRawBody(request: FastifyRequest): Buffer | undefined {
  return rawBodies.get(request);
}
