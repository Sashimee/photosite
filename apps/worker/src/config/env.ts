import { Global, Module } from '@nestjs/common';
import { z } from 'zod';

function optionalNonEmpty() {
  return z
    .string()
    .optional()
    .transform((value) => (value && value.length > 0 ? value : undefined));
}

// Rejects any value other than the literal strings "true"/"false" instead
// of silently treating garbage as false.
function optionalStrictBoolean() {
  return z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === 'true'));
}

const OptionalUrlSchema = z.preprocess(
  (value) => (typeof value === 'string' && value.length === 0 ? undefined : value),
  z.url().optional(),
);

const BaseEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']),
  DATABASE_URL: z.url(),
  REDIS_URL: z.url(),
  WEB_APP_URL: z.url(),

  HEALTH_PORT: z.coerce.number().int().positive().default(4100),

  CLAMAV_HOST: z.string().min(1).default('127.0.0.1'),
  CLAMAV_PORT: z.coerce.number().int().positive().default(3310),
  CLAMAV_SCAN_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  CLAMAV_MAX_SCAN_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(25 * 1024 * 1024),

  WORKER_CONCURRENCY_FILE_SCAN: z.coerce.number().int().positive().default(2),
  WORKER_CONCURRENCY_IMAGE_PROCESS: z.coerce.number().int().positive().default(2),
  WORKER_CONCURRENCY_UPLOADS_CLEANUP: z.coerce.number().int().positive().default(1),
  UPLOADS_CLEANUP_INTERVAL_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(10 * 60 * 1000),
  WORKER_CONCURRENCY_QUOTE_EXPIRY: z.coerce.number().int().positive().default(1),
  QUOTE_EXPIRY_INTERVAL_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(15 * 60 * 1000),
  WORKER_CONCURRENCY_LISTING_EXPIRY: z.coerce.number().int().positive().default(1),
  LISTING_EXPIRY_INTERVAL_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(60 * 60 * 1000),
  IMAGE_PROCESS_MAX_PIXELS: z.coerce.number().int().positive().default(100_000_000),

  S3_ENDPOINT: z.url(),
  S3_REGION: z.string().min(1),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_FORCE_PATH_STYLE: z
    .string()
    .optional()
    .transform((value) => value === 'true'),
  S3_PRIVATE_BUCKET: z.string().min(1),
  S3_PUBLIC_BUCKET: z.string().min(1),

  SMTP_HOST: z.string().min(1).optional(),
  SMTP_PORT: z.coerce.number().int().positive().optional(),
  SMTP_SECURE: optionalStrictBoolean(),
  SMTP_USER: optionalNonEmpty(),
  SMTP_PASSWORD: optionalNonEmpty(),
  SMTP_FROM: z.email().optional(),
  // Opt-out of production TLS enforcement (S1, issue #68) for a relay that
  // is only reachable on a private network (e.g. the preview's Mailpit
  // container). Defaults to false; every boot with it set logs a warning.
  SMTP_INSECURE_INTERNAL_RELAY: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),

  EXPO_ACCESS_TOKEN: optionalNonEmpty(),

  WORKER_CONCURRENCY_EMAIL: z.coerce.number().int().positive().default(3),
  WORKER_CONCURRENCY_NOTIFY: z.coerce.number().int().positive().default(3),
  WORKER_CONCURRENCY_NOTIFY_SWEEP: z.coerce.number().int().positive().default(1),
  WORKER_CONCURRENCY_PUSH_RECEIPTS: z.coerce.number().int().positive().default(1),
  WORKER_CONCURRENCY_NOTIFICATIONS_CLEANUP: z.coerce.number().int().positive().default(1),
  NOTIFY_SWEEP_INTERVAL_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(5 * 60 * 1000),
  PUSH_RECEIPTS_INTERVAL_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(15 * 60 * 1000),
  NOTIFICATIONS_CLEANUP_INTERVAL_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(24 * 60 * 60 * 1000),

  WORKER_CONCURRENCY_GDPR_EXPORT: z.coerce.number().int().positive().default(1),
  WORKER_CONCURRENCY_GDPR_SWEEP: z.coerce.number().int().positive().default(1),
  GDPR_SWEEP_INTERVAL_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(60 * 60 * 1000),

  SENTRY_DSN: OptionalUrlSchema,
  SENTRY_ENVIRONMENT: optionalNonEmpty(),
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0),
  SENTRY_REQUIRED: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
});

const EnvSchema = BaseEnvSchema.superRefine((value, ctx) => {
  if (value.NODE_ENV !== 'production') {
    return;
  }
  const required: (keyof typeof value)[] = [
    'SMTP_HOST',
    'SMTP_PORT',
    'SMTP_SECURE',
    'SMTP_USER',
    'SMTP_PASSWORD',
    'SMTP_FROM',
  ];
  for (const key of required) {
    if (value[key] === undefined) {
      ctx.addIssue({ code: 'custom', path: [key], message: `${key} is required in production` });
    }
  }
  if (!value.WEB_APP_URL.startsWith('https://')) {
    ctx.addIssue({
      code: 'custom',
      path: ['WEB_APP_URL'],
      message: 'must be an https:// URL in production',
    });
  }
  if (value.SENTRY_REQUIRED && !value.SENTRY_DSN) {
    ctx.addIssue({
      code: 'custom',
      path: ['SENTRY_DSN'],
      message: 'SENTRY_DSN is required when NODE_ENV=production and SENTRY_REQUIRED=true',
    });
  }
}).transform((value) => ({
  ...value,
  SMTP_HOST: value.SMTP_HOST ?? 'localhost',
  SMTP_PORT: value.SMTP_PORT ?? 1025,
  SMTP_SECURE: value.SMTP_SECURE ?? false,
  SMTP_FROM: value.SMTP_FROM ?? 'dev@photoo.lu',
}));

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(unknown variable)'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${details}`);
  }
  return parsed.data;
}

export const APP_CONFIG = Symbol('APP_CONFIG');

@Global()
@Module({
  providers: [{ provide: APP_CONFIG, useFactory: () => loadEnv() }],
  exports: [APP_CONFIG],
})
export class EnvModule {}
