import { HttpException } from '@nestjs/common';
import type { UserRole } from '@photoo/shared';

export function requireRole(user: { roles: string[] }, role: UserRole): void {
  if (!user.roles.includes(role)) {
    throw new HttpException({ code: 'FORBIDDEN', message: `${role} role required` }, 403);
  }
}
