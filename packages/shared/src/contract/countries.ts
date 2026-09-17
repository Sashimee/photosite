import { CountryCodeSchema, CurrencyCodeSchema, LocaleSchema } from './common.js';
import { apiPath, registry } from './registry.js';
import { z } from './zod.js';

export const CountrySummarySchema = z
  .object({
    code: CountryCodeSchema,
    name: z.string().min(1).max(120),
    currency: CurrencyCodeSchema,
    defaultLocale: LocaleSchema,
  })
  .strict()
  .openapi('CountrySummary');

registry.registerPath({
  method: 'get',
  path: apiPath('/countries'),
  summary: 'List enabled countries',
  tags: ['countries'],
  responses: {
    '200': {
      description: 'Enabled countries, ordered by name',
      content: { 'application/json': { schema: z.array(CountrySummarySchema) } },
    },
  },
});
