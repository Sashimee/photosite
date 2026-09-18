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

// Every key the schema declares must also appear as a literal
// `process.env.KEY` reference below, or Next leaves it undefined in the
// client bundle. env.test.ts asserts that from this list, so adding a key to
// the schema and forgetting the reference fails the suite instead of the
// browser.
export const ENV_KEYS = Object.keys(EnvSchema.shape) as (keyof typeof EnvSchema.shape)[];

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
