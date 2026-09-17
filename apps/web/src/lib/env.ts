import { z } from 'zod';

// Docker build args and compose `${VAR:-}` pass unset optionals as empty strings.
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema.optional());

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  NEXT_PUBLIC_API_URL: z.url(),
  NEXT_PUBLIC_SENTRY_DSN: optional(z.url()),
  SENTRY_REQUIRED: optional(z.enum(['true', 'false'])),
  NEXT_PUBLIC_ALLOW_INDEXING: z
    .string()
    .optional()
    .default('false')
    .transform((value) => value === 'true'),
});

function loadEnv() {
  const parsed = EnvSchema.safeParse(process.env);
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
