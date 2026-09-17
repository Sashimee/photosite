import { describe, expect, it } from 'vitest';
import {
  AddRoleRequestSchema,
  SignInRequestSchema,
  SignInResponseSchema,
  SignInTotpRequestSchema,
  SignUpRequestSchema,
  TotpDisableRequestSchema,
  TotpEnrollRequestSchema,
  TotpEnrollResponseSchema,
  TotpVerifyRequestSchema,
  UserSchema,
} from './auth.js';

const validUser = {
  id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  email: 'client@example.com',
  emailVerifiedAt: null,
  locale: 'en',
  country: 'LU',
  roles: ['client'],
  status: 'active',
  twoFactorEnabled: false,
  lastLoginAt: null,
};

describe('SignUpRequestSchema', () => {
  const valid = {
    email: 'client@example.com',
    password: 'correct horse battery staple',
    roles: ['client'],
    locale: 'en',
  };

  it('accepts a well-formed sign-up request', () => {
    expect(SignUpRequestSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects a password shorter than 10 characters', () => {
    expect(SignUpRequestSchema.safeParse({ ...valid, password: 'short1234' }).success).toBe(false);
  });

  it('accepts a password of exactly 10 characters', () => {
    expect(SignUpRequestSchema.safeParse({ ...valid, password: '1234567890' }).success).toBe(true);
  });

  it('rejects an admin role at sign-up', () => {
    expect(SignUpRequestSchema.safeParse({ ...valid, roles: ['admin'] }).success).toBe(false);
  });

  it('rejects an unknown role', () => {
    expect(SignUpRequestSchema.safeParse({ ...valid, roles: ['not-a-role'] }).success).toBe(false);
  });

  it('rejects duplicate roles', () => {
    expect(SignUpRequestSchema.safeParse({ ...valid, roles: ['client', 'client'] }).success).toBe(
      false,
    );
  });

  it('rejects an empty roles list', () => {
    expect(SignUpRequestSchema.safeParse({ ...valid, roles: [] }).success).toBe(false);
  });

  it('rejects an invalid email', () => {
    expect(SignUpRequestSchema.safeParse({ ...valid, email: 'not-an-email' }).success).toBe(false);
  });

  it('rejects an unsupported locale', () => {
    expect(SignUpRequestSchema.safeParse({ ...valid, locale: 'it' }).success).toBe(false);
  });

  it('rejects unknown keys', () => {
    expect(SignUpRequestSchema.safeParse({ ...valid, referralCode: 'abc' }).success).toBe(false);
  });
});

describe('SignInRequestSchema', () => {
  it('accepts email and password', () => {
    expect(
      SignInRequestSchema.safeParse({ email: 'client@example.com', password: 'x' }).success,
    ).toBe(true);
  });

  it('rejects an empty password', () => {
    expect(
      SignInRequestSchema.safeParse({ email: 'client@example.com', password: '' }).success,
    ).toBe(false);
  });

  it('rejects unknown keys', () => {
    expect(
      SignInRequestSchema.safeParse({
        email: 'client@example.com',
        password: 'x',
        rememberMe: true,
      }).success,
    ).toBe(false);
  });
});

describe('AddRoleRequestSchema', () => {
  it('accepts a signup-eligible role', () => {
    expect(AddRoleRequestSchema.safeParse({ role: 'photographer' }).success).toBe(true);
  });

  it('rejects the admin role', () => {
    expect(AddRoleRequestSchema.safeParse({ role: 'admin' }).success).toBe(false);
  });
});

describe('TotpVerifyRequestSchema', () => {
  it('accepts a 6-digit code', () => {
    expect(TotpVerifyRequestSchema.safeParse({ code: '123456' }).success).toBe(true);
  });

  it('rejects a code of the wrong length', () => {
    expect(TotpVerifyRequestSchema.safeParse({ code: '12345' }).success).toBe(false);
  });

  it('rejects a non-numeric code', () => {
    expect(TotpVerifyRequestSchema.safeParse({ code: 'abcdef' }).success).toBe(false);
  });
});

describe('SignInResponseSchema', () => {
  it('accepts a two-factor-required response', () => {
    expect(SignInResponseSchema.safeParse({ twoFactorRequired: true }).success).toBe(true);
  });

  it('accepts a full signed-in response', () => {
    expect(
      SignInResponseSchema.safeParse({
        user: validUser,
        session: { token: 'x', expiresAt: '2026-09-16T12:00:00.000Z' },
      }).success,
    ).toBe(true);
  });

  it('rejects a mixed shape', () => {
    expect(
      SignInResponseSchema.safeParse({ twoFactorRequired: true, user: validUser }).success,
    ).toBe(false);
  });
});

describe('SignInTotpRequestSchema', () => {
  it('accepts a code', () => {
    expect(SignInTotpRequestSchema.safeParse({ code: '123456' }).success).toBe(true);
  });

  it('accepts a backup code', () => {
    expect(SignInTotpRequestSchema.safeParse({ backupCode: 'abcde-12345' }).success).toBe(true);
  });

  it('rejects both a code and a backup code', () => {
    expect(
      SignInTotpRequestSchema.safeParse({ code: '123456', backupCode: 'abcde-12345' }).success,
    ).toBe(false);
  });

  it('rejects neither', () => {
    expect(SignInTotpRequestSchema.safeParse({}).success).toBe(false);
  });
});

describe('TotpEnrollResponseSchema', () => {
  it('requires backupCodes', () => {
    expect(
      TotpEnrollResponseSchema.safeParse({
        secret: 'JBSWY3DPEHPK3PXP',
        otpauthUrl: 'otpauth://totp/x?secret=JBSWY3DPEHPK3PXP',
      }).success,
    ).toBe(false);
  });

  it('accepts a full enrollment payload', () => {
    expect(
      TotpEnrollResponseSchema.safeParse({
        secret: 'JBSWY3DPEHPK3PXP',
        otpauthUrl: 'otpauth://totp/x?secret=JBSWY3DPEHPK3PXP',
        backupCodes: ['abcde-12345'],
      }).success,
    ).toBe(true);
  });
});

describe('TotpEnrollRequestSchema', () => {
  it('accepts a password', () => {
    expect(TotpEnrollRequestSchema.safeParse({ password: 'x' }).success).toBe(true);
  });

  it('rejects an empty password', () => {
    expect(TotpEnrollRequestSchema.safeParse({ password: '' }).success).toBe(false);
  });

  it('rejects unknown keys', () => {
    expect(TotpEnrollRequestSchema.safeParse({ password: 'x', extra: 1 }).success).toBe(false);
  });
});

describe('TotpDisableRequestSchema', () => {
  it('accepts a code and password', () => {
    expect(TotpDisableRequestSchema.safeParse({ code: '123456', password: 'x' }).success).toBe(
      true,
    );
  });

  it('rejects a missing password', () => {
    expect(TotpDisableRequestSchema.safeParse({ code: '123456' }).success).toBe(false);
  });
});

describe('UserSchema', () => {
  it('accepts a well-formed user', () => {
    expect(UserSchema.safeParse(validUser).success).toBe(true);
  });

  it('never accepts a passwordHash field', () => {
    expect(UserSchema.safeParse({ ...validUser, passwordHash: 'hash' }).success).toBe(false);
  });

  it('rejects an empty roles list', () => {
    expect(UserSchema.safeParse({ ...validUser, roles: [] }).success).toBe(false);
  });
});
