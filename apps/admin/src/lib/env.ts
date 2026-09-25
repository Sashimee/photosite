import { z } from 'zod';

// Docker build args and compose `${VAR:-}` pass unset optionals as empty strings.
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema.optional());

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  NEXT_PUBLIC_API_URL: z.url(),
  // Unset in production (admin.photoo.lu gets its own subdomain). Set to
  // "/admin" on the preview host, which has no admin.* DNS record yet
  // (docs/steps/1D.1-admin-shell.md) so the app is served under a path
  // prefix on the same host as the API instead.
  ADMIN_BASE_PATH: optional(z.string()),
  // Unset locally and until an admin Dockerfile sets it at build time; the
  // health page falls back to "dev" rather than a commit sha.
  NEXT_PUBLIC_BUILD_SHA: optional(z.string()),
  NEXT_PUBLIC_BUILD_TIME: optional(z.string()),
  // Origin of apps/api's S3_ENDPOINT (never exposed to this app directly),
  // needed in the CSP's connect-src so the browser can fetch a presigned
  // verification-document URL into a revocable object URL. Unset locally,
  // where the API origin already covers it through a reverse proxy.
  NEXT_PUBLIC_STORAGE_ORIGIN: optional(z.url()),
  // Origin (+ optional path prefix) that portfolio images are served from
  // (apps/api's S3_PUBLIC_BASE_URL, same variable apps/web reads as
  // NEXT_PUBLIC_MEDIA_BASE_URL). Needed in the CSP's img-src so the
  // moderation queue's portfolio-image target can render an <img> pointed
  // at it; unset blocks that preview rather than silently allowing any origin.
  NEXT_PUBLIC_MEDIA_BASE_URL: optional(z.url()),
});

// Every key the schema declares must also appear as a literal
// `process.env.KEY` reference below, or Next leaves it undefined in the
// client bundle. env.test.ts asserts that from this list, so adding a key to
// the schema and forgetting the reference fails the suite instead of the
// browser.
export const ENV_KEYS = Object.keys(EnvSchema.shape) as (keyof typeof EnvSchema.shape)[];

function loadEnv() {
  // Next only substitutes *literal* `process.env.NEXT_PUBLIC_X` references
  // into the client bundle, so passing the whole `process.env` object leaves
  // public values `undefined` in the browser and makes this module throw at
  // evaluation. Keep each key spelled out. (The same bug took every
  // data-driven page of apps/web down on the preview.)
  const parsed = EnvSchema.safeParse({
    NODE_ENV: process.env.NODE_ENV,
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
    ADMIN_BASE_PATH: process.env.ADMIN_BASE_PATH,
    NEXT_PUBLIC_BUILD_SHA: process.env.NEXT_PUBLIC_BUILD_SHA,
    NEXT_PUBLIC_BUILD_TIME: process.env.NEXT_PUBLIC_BUILD_TIME,
    NEXT_PUBLIC_STORAGE_ORIGIN: process.env.NEXT_PUBLIC_STORAGE_ORIGIN,
    NEXT_PUBLIC_MEDIA_BASE_URL: process.env.NEXT_PUBLIC_MEDIA_BASE_URL,
  });
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(unknown variable)'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${details}`);
  }
  return parsed.data;
}

export const env = loadEnv();
