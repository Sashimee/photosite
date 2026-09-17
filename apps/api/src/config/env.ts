import { Global, Module } from '@nestjs/common';
import { z } from 'zod';

const WebOriginsSchema = z
  .string()
  .min(1)
  .transform((value, ctx) => {
    const origins = value
      .split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0);

    if (origins.length === 0) {
      ctx.addIssue({ code: 'custom', message: 'must contain at least one origin' });
      return z.NEVER;
    }

    for (const origin of origins) {
      try {
        new URL(origin);
      } catch {
        ctx.addIssue({ code: 'custom', message: `"${origin}" is not a valid origin URL` });
        return z.NEVER;
      }
    }

    return origins;
  });

const AUTH_ENCRYPTION_KEY_BYTES = 32;

const AuthEncryptionKeySchema = z
  .string()
  .min(1)
  .transform((value, ctx) => {
    let decoded: Buffer;
    try {
      decoded = Buffer.from(value, 'base64');
    } catch {
      ctx.addIssue({ code: 'custom', message: 'must be base64-encoded' });
      return z.NEVER;
    }
    if (decoded.length !== AUTH_ENCRYPTION_KEY_BYTES) {
      ctx.addIssue({
        code: 'custom',
        message: `must decode to exactly ${String(AUTH_ENCRYPTION_KEY_BYTES)} bytes (got ${String(decoded.length)})`,
      });
      return z.NEVER;
    }
    return decoded;
  });

function optionalNonEmpty() {
  return z
    .string()
    .optional()
    .transform((value) => (value && value.length > 0 ? value : undefined))
    .optional();
}

const TrustedProxiesSchema = z
  .string()
  .optional()
  .transform((value) =>
    (value ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
  );

const BooleanFlagSchema = z
  .string()
  .optional()
  .transform((value) => value === 'true');

const EXAMPLE_AUTH_SECRET = 'dev-only-auth-secret-change-me-please-32-chars-min';
const EXAMPLE_AUTH_ENCRYPTION_KEYS = [
  'qA5jxlkWykGDbMKLOSqgSGG+lbzsuDkUWUS8nV9twig=',
  '2uHUiw1qPXOZEq5zpsVlwyZ4XJDaEo1no7lrqawjTxM=',
];

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']),
    DATABASE_URL: z.url(),
    REDIS_URL: z.url(),
    PORT: z.coerce.number().int().positive().default(4000),
    PUBLIC_API_URL: z.url(),
    WEB_ORIGINS: WebOriginsSchema,
    WEB_APP_URL: z.url(),
    TRUSTED_PROXIES: TrustedProxiesSchema,

    AUTH_SECRET: z.string().min(32, 'must be at least 32 characters'),
    AUTH_ENCRYPTION_KEY: AuthEncryptionKeySchema,

    DEV_MAIL_WORKER: BooleanFlagSchema,

    GOOGLE_CLIENT_ID: optionalNonEmpty(),
    GOOGLE_CLIENT_SECRET: optionalNonEmpty(),
    APPLE_CLIENT_ID: optionalNonEmpty(),
    APPLE_CLIENT_SECRET: optionalNonEmpty(),
    FACEBOOK_CLIENT_ID: optionalNonEmpty(),
    FACEBOOK_CLIENT_SECRET: optionalNonEmpty(),
    MICROSOFT_CLIENT_ID: optionalNonEmpty(),
    MICROSOFT_CLIENT_SECRET: optionalNonEmpty(),

    SMTP_HOST: z.string().min(1).default('localhost'),
    SMTP_PORT: z.coerce.number().int().positive().default(1025),
    SMTP_FROM: z.email().default('dev@photoo.lu'),
  })
  .superRefine((value, ctx) => {
    if (value.NODE_ENV !== 'production') {
      return;
    }
    if (value.AUTH_SECRET === EXAMPLE_AUTH_SECRET) {
      ctx.addIssue({
        code: 'custom',
        path: ['AUTH_SECRET'],
        message: 'refusing the .env.example placeholder value in production',
      });
    }
  });

export type Env = z.infer<typeof EnvSchema>;

function rejectExamplePlaceholders(source: NodeJS.ProcessEnv): string | undefined {
  if (source.NODE_ENV !== 'production') {
    return undefined;
  }
  const encryptionKey = source.AUTH_ENCRYPTION_KEY;
  if (encryptionKey && EXAMPLE_AUTH_ENCRYPTION_KEYS.includes(encryptionKey)) {
    return 'AUTH_ENCRYPTION_KEY: refusing the .env.example placeholder value in production';
  }
  return undefined;
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const placeholderError = rejectExamplePlaceholders(source);
  if (placeholderError) {
    throw new Error(`Invalid environment configuration: ${placeholderError}`);
  }

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
