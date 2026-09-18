import { z } from 'zod';

// Docker build args and compose `${VAR:-}` pass unset optionals as empty strings.
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema.optional());

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  NEXT_PUBLIC_API_URL: z.url(),
  // Server-side base URL for API calls made inside the container. On the
  // preview, NEXT_PUBLIC_API_URL is the public hostname, so every
  // server-rendered page's fetch left the container, came back in through
  // Traefik and its CrowdSec bouncer, and counted as public traffic - which
  // is how a burst of SSR requests got the host's own IP banned and turned
  // every data-driven page into an error. Server code uses this instead;
  // unset it and behaviour is exactly as before.
  API_INTERNAL_URL: optional(z.url()),
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
