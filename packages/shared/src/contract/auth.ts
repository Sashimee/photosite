import { USER_ROLES, USER_STATUSES, type UserRole } from '../enums.js';
import {
  CountryCodeSchema,
  IdSchema,
  IsoDateTimeSchema,
  LocaleSchema,
  errorResponses,
} from './common.js';
import { API_PREFIX, AUTH_SECURITY, apiPath, registry } from './registry.js';
import { z } from './zod.js';

const PASSWORD_MIN_LENGTH = 10;

const SIGNUP_ROLES = [
  'client',
  'photographer',
  'professional',
] as const satisfies readonly UserRole[];

const OAUTH_PROVIDERS = ['google', 'apple', 'facebook', 'microsoft'] as const;

const PasswordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `must be at least ${String(PASSWORD_MIN_LENGTH)} characters`)
  .max(256)
  .openapi({ example: 'correct horse battery staple' });

export const UserSchema = z
  .object({
    id: IdSchema,
    email: z.email().openapi({ example: 'client@example.com' }),
    emailVerifiedAt: IsoDateTimeSchema.nullable(),
    locale: LocaleSchema,
    country: CountryCodeSchema,
    roles: z
      .array(z.enum(USER_ROLES))
      .min(1)
      .openapi({ example: ['client'] }),
    status: z.enum(USER_STATUSES),
    twoFactorEnabled: z.boolean(),
    lastLoginAt: IsoDateTimeSchema.nullable(),
  })
  .strict()
  .openapi('User');

export const AuthSessionSchema = z
  .object({
    token: z.string().openapi({ example: 'sess_3fa85f64571445' }),
    expiresAt: IsoDateTimeSchema,
  })
  .strict()
  .openapi('AuthSession');

export const SignUpRequestSchema = z
  .object({
    email: z.email().openapi({ example: 'client@example.com' }),
    password: PasswordSchema,
    roles: z
      .array(z.enum(SIGNUP_ROLES))
      .min(1)
      .max(SIGNUP_ROLES.length)
      .refine((roles) => new Set(roles).size === roles.length, 'roles must be unique')
      .openapi({ example: ['client'] }),
    locale: LocaleSchema,
  })
  .strict();

export const SignUpResponseSchema = z
  .object({
    user: UserSchema,
  })
  .strict();

export const SignInRequestSchema = z
  .object({
    email: z.email().openapi({ example: 'client@example.com' }),
    password: z.string().min(1).openapi({ example: 'correct horse battery staple' }),
  })
  .strict();

export const SignInResponseSchema = z
  .object({
    user: UserSchema,
    session: AuthSessionSchema,
  })
  .strict();

export const SessionResponseSchema = z
  .object({
    user: UserSchema,
  })
  .strict();

export const VerifyEmailRequestSchema = z
  .object({
    token: z.string().min(1).openapi({ example: 'a1b2c3d4e5f6' }),
  })
  .strict();

export const RequestPasswordResetRequestSchema = z
  .object({
    email: z.email().openapi({ example: 'client@example.com' }),
  })
  .strict();

export const RequestPasswordResetResponseSchema = z
  .object({
    message: z.string().openapi({ example: 'If an account exists, a reset email has been sent.' }),
  })
  .strict();

export const ConfirmPasswordResetRequestSchema = z
  .object({
    token: z.string().min(1).openapi({ example: 'a1b2c3d4e5f6' }),
    password: PasswordSchema,
  })
  .strict();

export const ConfirmPasswordResetResponseSchema = z
  .object({
    message: z.string().openapi({ example: 'Password updated.' }),
  })
  .strict();

export const AddRoleRequestSchema = z
  .object({
    role: z.enum(SIGNUP_ROLES).openapi({ example: 'photographer' }),
  })
  .strict();

export const AddRoleResponseSchema = z
  .object({
    user: UserSchema,
  })
  .strict();

export const TotpEnrollResponseSchema = z
  .object({
    secret: z.string().openapi({ example: 'JBSWY3DPEHPK3PXP' }),
    otpauthUrl: z
      .url()
      .openapi({ example: 'otpauth://totp/photoo.lu:client@example.com?secret=JBSWY3DPEHPK3PXP' }),
  })
  .strict()
  .openapi('TotpEnrollment');

const TotpCodeSchema = z
  .string()
  .regex(/^\d{6}$/, 'must be a 6-digit code')
  .openapi({ example: '123456' });

export const TotpVerifyRequestSchema = z
  .object({
    code: TotpCodeSchema,
  })
  .strict();

export const TotpDisableRequestSchema = z
  .object({
    code: TotpCodeSchema,
  })
  .strict();

export const TotpResponseSchema = z
  .object({
    user: UserSchema,
  })
  .strict();

registry.registerPath({
  method: 'post',
  path: apiPath('/auth/sign-up'),
  summary: 'Create an account',
  tags: ['auth'],
  request: {
    body: { content: { 'application/json': { schema: SignUpRequestSchema } } },
  },
  responses: {
    '201': {
      description: 'Account created, verification email sent',
      content: { 'application/json': { schema: SignUpResponseSchema } },
    },
    ...errorResponses([400, 409, 422, 429]),
  },
});

registry.registerPath({
  method: 'post',
  path: apiPath('/auth/sign-in'),
  summary: 'Sign in with email and password',
  tags: ['auth'],
  request: {
    body: { content: { 'application/json': { schema: SignInRequestSchema } } },
  },
  responses: {
    '200': {
      description: 'Signed in',
      content: { 'application/json': { schema: SignInResponseSchema } },
    },
    ...errorResponses([400, 401, 403, 422, 429]),
  },
});

registry.registerPath({
  method: 'post',
  path: apiPath('/auth/sign-out'),
  summary: 'Sign out of the current session',
  tags: ['auth'],
  security: AUTH_SECURITY,
  responses: {
    '204': { description: 'Signed out' },
    ...errorResponses([401]),
  },
});

registry.registerPath({
  method: 'get',
  path: apiPath('/auth/session'),
  summary: 'Get the current session user',
  tags: ['auth'],
  security: AUTH_SECURITY,
  responses: {
    '200': {
      description: 'Current session user',
      content: { 'application/json': { schema: SessionResponseSchema } },
    },
    ...errorResponses([401]),
  },
});

registry.registerPath({
  method: 'post',
  path: apiPath('/auth/verify-email'),
  summary: 'Confirm an email verification token',
  tags: ['auth'],
  request: {
    body: { content: { 'application/json': { schema: VerifyEmailRequestSchema } } },
  },
  responses: {
    '200': {
      description: 'Email verified',
      content: { 'application/json': { schema: SessionResponseSchema } },
    },
    ...errorResponses([400, 404, 409, 422, 429]),
  },
});

registry.registerPath({
  method: 'post',
  path: apiPath('/auth/password-reset/request'),
  summary: 'Request a password reset email',
  tags: ['auth'],
  request: {
    body: { content: { 'application/json': { schema: RequestPasswordResetRequestSchema } } },
  },
  responses: {
    '202': {
      description: 'Reset email sent if the account exists',
      content: { 'application/json': { schema: RequestPasswordResetResponseSchema } },
    },
    ...errorResponses([400, 422, 429]),
  },
});

registry.registerPath({
  method: 'post',
  path: apiPath('/auth/password-reset/confirm'),
  summary: 'Confirm a password reset with a new password',
  tags: ['auth'],
  request: {
    body: { content: { 'application/json': { schema: ConfirmPasswordResetRequestSchema } } },
  },
  responses: {
    '200': {
      description: 'Password updated',
      content: { 'application/json': { schema: ConfirmPasswordResetResponseSchema } },
    },
    ...errorResponses([400, 404, 409, 422, 429]),
  },
});

registry.registerPath({
  method: 'post',
  path: apiPath('/auth/roles'),
  summary: "Add a role to the current user's account",
  tags: ['auth'],
  security: AUTH_SECURITY,
  request: {
    body: { content: { 'application/json': { schema: AddRoleRequestSchema } } },
  },
  responses: {
    '200': {
      description: 'Role added',
      content: { 'application/json': { schema: AddRoleResponseSchema } },
    },
    ...errorResponses([400, 401, 409, 422]),
  },
});

registry.registerPath({
  method: 'post',
  path: apiPath('/auth/totp/enroll'),
  summary: 'Start TOTP enrollment for the current user',
  tags: ['auth'],
  security: AUTH_SECURITY,
  responses: {
    '200': {
      description: 'TOTP secret and enrollment URI',
      content: { 'application/json': { schema: TotpEnrollResponseSchema } },
    },
    ...errorResponses([401, 409]),
  },
});

registry.registerPath({
  method: 'post',
  path: apiPath('/auth/totp/verify'),
  summary: 'Confirm TOTP enrollment with a generated code',
  tags: ['auth'],
  security: AUTH_SECURITY,
  request: {
    body: { content: { 'application/json': { schema: TotpVerifyRequestSchema } } },
  },
  responses: {
    '200': {
      description: 'TOTP enabled',
      content: { 'application/json': { schema: TotpResponseSchema } },
    },
    ...errorResponses([400, 401, 409, 422]),
  },
});

registry.registerPath({
  method: 'post',
  path: apiPath('/auth/totp/disable'),
  summary: 'Disable TOTP for the current user',
  tags: ['auth'],
  security: AUTH_SECURITY,
  request: {
    body: { content: { 'application/json': { schema: TotpDisableRequestSchema } } },
  },
  responses: {
    '200': {
      description: 'TOTP disabled',
      content: { 'application/json': { schema: TotpResponseSchema } },
    },
    ...errorResponses([400, 401, 409, 422]),
  },
});

for (const provider of OAUTH_PROVIDERS) {
  registry.registerPath({
    method: 'get',
    path: apiPath(`/auth/oauth/${provider}/start`),
    summary: `Start the ${provider} OAuth sign-in redirect`,
    tags: ['auth'],
    responses: {
      '302': { description: `Redirect to the ${provider} OAuth consent screen` },
      ...errorResponses([400, 429]),
    },
  });
}

export { API_PREFIX, OAUTH_PROVIDERS, SIGNUP_ROLES };
