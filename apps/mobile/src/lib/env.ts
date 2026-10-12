import { z } from 'zod';

const EnvSchema = z.object({
  EXPO_PUBLIC_API_URL: z.url(),
  EXPO_PUBLIC_SENTRY_DSN: z.url().optional(),
  EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY: z
    .string()
    .regex(
      /^pk_test_\w+$/,
      'must be a Stripe test publishable key (pk_test_...); live keys are not allowed until a launch decision',
    )
    .optional(),
  EXPO_PUBLIC_STRIPE_MERCHANT_IDENTIFIER: z
    .string()
    .regex(/^merchant\..+$/, 'must be an Apple merchant identifier (merchant.<reverse-domain>)')
    .optional(),
});

function loadEnv() {
  const parsed = EnvSchema.safeParse({
    EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL,
    EXPO_PUBLIC_SENTRY_DSN: process.env.EXPO_PUBLIC_SENTRY_DSN,
    EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY: process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY,
    EXPO_PUBLIC_STRIPE_MERCHANT_IDENTIFIER: process.env.EXPO_PUBLIC_STRIPE_MERCHANT_IDENTIFIER,
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
