import { CountryCodeSchema, errorResponses } from './common.js';
import { apiPath, registry } from './registry.js';
import { z } from './zod.js';

export const CitySummarySchema = z
  .object({
    slug: z.string().min(1).max(60),
    name: z.string().min(1).max(120),
    countryCode: CountryCodeSchema,
    photographerCount: z.int().positive(),
  })
  .strict()
  .openapi('CitySummary');

export const CitiesQuerySchema = z
  .object({
    countryCode: CountryCodeSchema.optional(),
    q: z.string().min(1).max(60).optional(),
    limit: z.coerce.number().int().min(1).max(20).default(20),
  })
  .strict();

registry.registerPath({
  method: 'get',
  path: apiPath('/cities'),
  summary: 'List cities with published photographer profiles',
  tags: ['cities'],
  request: {
    query: CitiesQuerySchema,
  },
  responses: {
    '200': {
      description: 'Matching cities, ordered by photographer count then name',
      content: { 'application/json': { schema: z.array(CitySummarySchema) } },
    },
    ...errorResponses([400, 422]),
  },
});
