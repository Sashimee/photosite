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

// `null` means nothing has ever been published (docs/steps/1D.7-settings.md,
// docs/steps/1B.10-consent.md): 1B.10 treats that the same as a version
// bump and shows the consent banner rather than skipping it.
export const PolicyVersionResponseSchema = z
  .object({
    policyVersion: z.string().min(1).max(20).nullable(),
  })
  .strict()
  .openapi('PolicyVersion');

registry.registerPath({
  method: 'get',
  path: apiPath('/policy-version'),
  summary: 'Get the currently published consent policy version',
  tags: ['countries'],
  responses: {
    '200': {
      description: 'The current policy version, or null if none has been published yet',
      content: { 'application/json': { schema: PolicyVersionResponseSchema } },
    },
  },
});
