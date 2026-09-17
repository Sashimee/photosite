import { UserSchema } from '@photoo/shared';
import type { z } from 'zod';

export interface AuthUserLike {
  id: string;
  email: string;
  emailVerifiedAt?: Date | string | null;
  locale: string;
  countryCode: string;
  roles: readonly string[];
  status: string;
  twoFactorEnabled?: boolean | null;
  lastLoginAt?: Date | string | null;
}

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function mapUser(user: AuthUserLike): z.infer<typeof UserSchema> {
  return UserSchema.parse({
    id: user.id,
    email: user.email,
    emailVerifiedAt: toIso(user.emailVerifiedAt),
    locale: user.locale,
    country: user.countryCode,
    roles: user.roles,
    status: user.status,
    twoFactorEnabled: Boolean(user.twoFactorEnabled),
    lastLoginAt: toIso(user.lastLoginAt),
  });
}
