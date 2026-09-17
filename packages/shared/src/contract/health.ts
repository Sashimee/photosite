import { ApiErrorSchema } from './common.js';
import { registry } from './registry.js';
import { z } from './zod.js';

export const HealthResponseSchema = z
  .object({
    status: z.literal('ok'),
  })
  .strict()
  .openapi('HealthResponse');

export const ReadyResponseSchema = z
  .object({
    status: z.literal('ok'),
    checks: z
      .object({
        database: z.literal('ok'),
        redis: z.literal('ok'),
      })
      .strict(),
  })
  .strict()
  .openapi('ReadyResponse');

registry.registerPath({
  method: 'get',
  path: '/health',
  summary: 'Liveness check',
  tags: ['system'],
  responses: {
    '200': {
      description: 'The service process is running',
      content: { 'application/json': { schema: HealthResponseSchema } },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/ready',
  summary: 'Readiness check: database and Redis are reachable',
  tags: ['system'],
  responses: {
    '200': {
      description: 'The service and its dependencies are reachable',
      content: { 'application/json': { schema: ReadyResponseSchema } },
    },
    '503': {
      description: 'A dependency is unreachable',
      content: { 'application/json': { schema: ApiErrorSchema } },
    },
  },
});
