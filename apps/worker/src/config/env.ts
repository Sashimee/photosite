import { Global, Module } from '@nestjs/common';
import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']),
  DATABASE_URL: z.url(),
  REDIS_URL: z.url(),

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
});

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
