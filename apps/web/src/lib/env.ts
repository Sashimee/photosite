import { z } from 'zod';

// Docker build args and compose `${VAR:-}` pass unset optionals as empty strings.
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema.optional());

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  NEXT_PUBLIC_API_URL: z.url(),
  // The app's own public origin (no path): required so canonical URLs,
  // hreflang alternates and JSON-LD resolve to the real deployment instead
  // of Next's http://localhost:3000 metadataBase default.
  NEXT_PUBLIC_SITE_URL: z.url(),
  NEXT_PUBLIC_MEDIA_BASE_URL: optional(z.url()),
  NEXT_PUBLIC_SENTRY_DSN: optional(z.url()),
  SENTRY_REQUIRED: optional(z.enum(['true', 'false'])),
  NEXT_PUBLIC_ALLOW_INDEXING: z
    .string()
    .optional()
    .default('false')
    .transform((value) => value === 'true'),
});

function loadEnv() {
  // Next only substitutes *literal* `process.env.NEXT_PUBLIC_X` references
  // when it builds the client bundle; handing the whole `process.env` object
  // to zod leaves every public value `undefined` in the browser, so this
  // module threw at evaluation and took down any page whose client bundle
  // imported it. The home page survived only because none of its client
  // components import this file. Each key must stay spelled out here.
  const parsed = EnvSchema.safeParse({
    NODE_ENV: process.env.NODE_ENV,
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
    NEXT_PUBLIC_MEDIA_BASE_URL: process.env.NEXT_PUBLIC_MEDIA_BASE_URL,
    NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
    NEXT_PUBLIC_ALLOW_INDEXING: process.env.NEXT_PUBLIC_ALLOW_INDEXING,
    SENTRY_REQUIRED: process.env.SENTRY_REQUIRED,
    API_INTERNAL_URL: process.env.API_INTERNAL_URL,
  });
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(unknown variable)'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${details}`);
  }

  if (
    parsed.data.NODE_ENV === 'production' &&
    parsed.data.SENTRY_REQUIRED === 'true' &&
    !parsed.data.NEXT_PUBLIC_SENTRY_DSN
  ) {
    throw new Error(
      'Invalid environment configuration: NEXT_PUBLIC_SENTRY_DSN is required when NODE_ENV=production and SENTRY_REQUIRED=true',
    );
  }

  return parsed.data;
}

export const env = loadEnv();
