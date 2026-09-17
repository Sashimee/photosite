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

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z.url(),
  REDIS_URL: z.url(),
  PORT: z.coerce.number().int().positive().default(4000),
  PUBLIC_API_URL: z.url(),
  WEB_ORIGINS: WebOriginsSchema,
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
