import { AdminUserSchema } from '@photoo/shared';
import type { z } from 'zod';
import { mapUser, type AuthUserLike } from '../auth/user-mapper.js';

export interface AdminUserLike extends AuthUserLike {
  name: string | null;
  photographerProfile: { slug: string; isPublished: boolean } | null;
}

// Admin-only projection: `name` and the photographer-profile summary never
// go through `mapUser` (auth/user-mapper.ts), so they cannot leak into the
// session, public profile or chat DTOs that reuse it.
export function mapAdminUser(user: AdminUserLike): z.infer<typeof AdminUserSchema> {
  return AdminUserSchema.parse({
    ...mapUser(user),
    name: user.name,
    photographerProfile: user.photographerProfile
      ? {
          slug: user.photographerProfile.slug,
          isPublished: user.photographerProfile.isPublished,
        }
      : null,
  });
}
