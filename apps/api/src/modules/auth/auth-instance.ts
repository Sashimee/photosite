import { prismaAdapter } from '@better-auth/prisma-adapter';
import type { PrismaClient } from '@photoo/db';
import { SIGNUP_ROLES, SUPPORTED_LOCALES } from '@photoo/shared';
import { betterAuth } from 'better-auth';
import { bearer, twoFactor, type TwoFactorOptions } from 'better-auth/plugins';
import type { Logger } from 'nestjs-pino';
import { z } from 'zod';
import type { RedisRateLimiter } from '../../common/rate-limit/redis-rate-limiter.js';
import type { Env } from '../../config/env.js';
import type { ChatSocketBridge } from '../chat/chat-socket-bridge.js';
import { hardenAdapter } from './adapter/hardened-adapter.js';
import { withEmailVerifiedBridge } from './adapter/user-email-verified-extension.js';
import { createBackupCodesCipher } from './crypto/backup-codes-cipher.js';
import { DISABLED_BETTER_AUTH_PATHS } from './disabled-paths.js';
import type { EmailQueueService } from './mailer/email-queue.service.js';
import { createPasswordHasher } from './password.js';
import { createRedisRateLimitStorage } from './rate-limit-storage.js';
import { randomUuidV7 } from './uuid-v7.js';

const ONE_HOUR_SECONDS = 60 * 60;
const ONE_DAY_SECONDS = 24 * ONE_HOUR_SECONDS;
const THIRTY_DAYS_SECONDS = 30 * ONE_DAY_SECONDS;

export interface BuildAuthDeps {
  config: Env;
  prisma: PrismaClient;
  rateLimiter: RedisRateLimiter;
  emailQueue: EmailQueueService;
  chatSocketBridge: ChatSocketBridge;
  logger: Logger;
}

function buildSocialProviders(
  config: Env,
): Record<string, { clientId: string; clientSecret: string }> {
  const providers: Record<string, { clientId: string; clientSecret: string }> = {};
  if (config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET) {
    providers.google = {
      clientId: config.GOOGLE_CLIENT_ID,
      clientSecret: config.GOOGLE_CLIENT_SECRET,
    };
  }
  if (config.APPLE_CLIENT_ID && config.APPLE_CLIENT_SECRET) {
    providers.apple = {
      clientId: config.APPLE_CLIENT_ID,
      clientSecret: config.APPLE_CLIENT_SECRET,
    };
  }
  if (config.FACEBOOK_CLIENT_ID && config.FACEBOOK_CLIENT_SECRET) {
    providers.facebook = {
      clientId: config.FACEBOOK_CLIENT_ID,
      clientSecret: config.FACEBOOK_CLIENT_SECRET,
    };
  }
  if (config.MICROSOFT_CLIENT_ID && config.MICROSOFT_CLIENT_SECRET) {
    providers.microsoft = {
      clientId: config.MICROSOFT_CLIENT_ID,
      clientSecret: config.MICROSOFT_CLIENT_SECRET,
    };
  }
  return providers;
}

export function buildAuth({
  config,
  prisma: rawPrisma,
  rateLimiter,
  emailQueue,
  chatSocketBridge,
  logger,
}: BuildAuthDeps) {
  const prisma = withEmailVerifiedBridge(rawPrisma);

  const twoFactorOptions = {
    issuer: 'photoo.lu',
    backupCodeOptions: {
      storeBackupCodes: createBackupCodesCipher(config.AUTH_ENCRYPTION_KEY),
    },
  } satisfies TwoFactorOptions;

  return betterAuth({
    appName: 'photoo.lu',
    baseURL: config.PUBLIC_API_URL,
    basePath: '/v1/auth',
    secret: config.AUTH_SECRET,
    disabledPaths: DISABLED_BETTER_AUTH_PATHS,
    database: hardenAdapter(
      prismaAdapter(prisma, { provider: 'postgresql' }),
      config.AUTH_ENCRYPTION_KEY,
    ),
    advanced: {
      database: { generateId: false },
      useSecureCookies:
        config.NODE_ENV === 'production' || config.PUBLIC_API_URL.startsWith('https://'),
      cookies: {
        session_token: { name: 'photoo_session', attributes: { sameSite: 'lax' } },
      },
      ipAddress: {
        trustedProxies: [...config.TRUSTED_PROXIES],
      },
    },
    trustedOrigins: config.WEB_ORIGINS,
    session: {
      expiresIn: THIRTY_DAYS_SECONDS,
      updateAge: ONE_DAY_SECONDS,
      fields: { ipAddress: 'ip', token: 'tokenHash' },
      additionalFields: {
        // Never set by Better Auth itself (input: false, no default): only
        // the sign-in/totp and totp/verify handlers stamp this, on the
        // session that actually presented a second factor. A session
        // created any other way (password-only, OAuth callback) keeps it
        // null.
        twoFactorVerifiedAt: { type: 'date', required: false, input: false },
      },
    },
    user: {
      additionalFields: {
        roles: {
          type: 'string[]',
          required: true,
          input: true,
          validator: {
            input: z
              .array(z.enum(SIGNUP_ROLES))
              .min(1)
              .max(SIGNUP_ROLES.length)
              .refine((roles) => new Set(roles).size === roles.length),
          },
        },
        locale: {
          type: 'string',
          required: true,
          input: true,
          validator: { input: z.enum(SUPPORTED_LOCALES) },
        },
        countryCode: {
          type: 'string',
          required: true,
          input: true,
          validator: { input: z.string().regex(/^[A-Z]{2}$/) },
        },
        status: { type: 'string', required: false, defaultValue: 'active', input: false },
        lastLoginAt: { type: 'date', required: false, input: false },
        emailVerifiedAt: { type: 'date', required: false, input: false },
      },
    },
    verification: { storeIdentifier: 'hashed' },
    emailVerification: {
      sendVerificationEmail: async ({ user, token }) => {
        const url = `${config.WEB_APP_URL}/verify-email#token=${encodeURIComponent(token)}`;
        await emailQueue.enqueue({ type: 'verify-email', to: user.email, url });
      },
      sendOnSignUp: true,
      expiresIn: ONE_DAY_SECONDS,
      autoSignInAfterVerification: true,
    },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
      maxPasswordLength: 256,
      requireEmailVerification: true,
      password: createPasswordHasher(),
      sendResetPassword: async ({ user, token }) => {
        const url = `${config.WEB_APP_URL}/reset-password#token=${encodeURIComponent(token)}`;
        await emailQueue.enqueue({ type: 'reset-password', to: user.email, url });
      },
      resetPasswordTokenExpiresIn: ONE_HOUR_SECONDS,
      revokeSessionsOnPasswordReset: true,
      // Runs after Better Auth has already resolved the reset token to a
      // user (issue #101); no need to verify the token ourselves.
      onPasswordReset: ({ user }) => {
        chatSocketBridge.disconnectUser(user.id);
        return Promise.resolve();
      },
      onExistingUserSignUp: async ({ user }) => {
        await emailQueue.enqueue({ type: 'account-exists', to: user.email });
      },
      customSyntheticUser: ({ coreFields, additionalFields }) => ({
        ...coreFields,
        ...additionalFields,
        id: randomUuidV7(),
        status: 'active',
        emailVerifiedAt: null,
        lastLoginAt: null,
        twoFactorEnabled: false,
        roles: additionalFields.roles ?? ['client'],
        locale: additionalFields.locale ?? 'en',
        countryCode: additionalFields.countryCode ?? 'LU',
      }),
    },
    socialProviders: buildSocialProviders(config),
    plugins: [bearer(), twoFactor(twoFactorOptions)],
    rateLimit: {
      enabled: true,
      customStorage: createRedisRateLimitStorage(rateLimiter),
      window: 60,
      max: 30,
    },
    databaseHooks: {
      session: {
        create: {
          before: async (session) => {
            const user = await prisma.user.findUnique({
              where: { id: session.userId },
              select: { status: true },
            });
            if (user && user.status !== 'active') {
              return false;
            }
            return undefined;
          },
          after: async (session) => {
            await prisma.user.update({
              where: { id: session.userId },
              data: { lastLoginAt: new Date() },
            });
          },
        },
      },
    },
    logger: {
      disabled: false,
      log: (level, message, ...args) => {
        const context = { context: 'BetterAuth', args };
        if (level === 'error') {
          logger.error(context, message);
        } else if (level === 'warn') {
          logger.warn(context, message);
        } else if (level === 'debug') {
          logger.debug(context, message);
        } else {
          logger.log(context, message);
        }
      },
    },
  });
}

export type Auth = ReturnType<typeof buildAuth>;
