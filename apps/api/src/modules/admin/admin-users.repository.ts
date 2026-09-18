import { Inject, Injectable } from '@nestjs/common';
import type { Prisma, UserRole, UserStatus } from '@photoo/db';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { AdminUserCursor } from './admin-user-cursor.js';

const PHOTOGRAPHER_PROFILE_SUMMARY_INCLUDE = {
  photographerProfile: { select: { slug: true, isPublished: true } },
} as const;

export interface AdminUserSearchFilters {
  q?: string;
  role?: UserRole;
  status?: UserStatus;
  cursor?: AdminUserCursor;
  limit: number;
}

function cursorWhere(cursor: AdminUserCursor): Prisma.UserWhereInput {
  const createdAt = new Date(cursor.createdAt);
  return {
    OR: [{ createdAt: { gt: createdAt } }, { createdAt, id: { gt: cursor.id } }],
  };
}

@Injectable()
export class AdminUsersRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async search(filters: AdminUserSearchFilters) {
    // Combined with `AND`, never spread into one object, so the cursor's
    // `OR` and the `q` search's `OR` (both needed at once when paging
    // through a search) don't collide on the same key.
    const and: Prisma.UserWhereInput[] = [];
    if (filters.role) {
      and.push({ roles: { has: filters.role } });
    }
    if (filters.status) {
      and.push({ status: filters.status });
    }
    if (filters.q) {
      // Exact id, exact email or a displayName prefix - never a `contains`
      // over email (docs/steps/1A.11-admin-api.md): a substring search over
      // every user's email is a data-exfiltration primitive.
      and.push({
        OR: [
          { id: filters.q },
          { email: filters.q },
          { name: { startsWith: filters.q, mode: 'insensitive' } },
        ],
      });
    }
    if (filters.cursor) {
      and.push(cursorWhere(filters.cursor));
    }
    const where: Prisma.UserWhereInput = and.length > 0 ? { AND: and } : {};

    return this.prisma.client.user.findMany({
      where,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: filters.limit + 1,
      include: PHOTOGRAPHER_PROFILE_SUMMARY_INCLUDE,
    });
  }

  findById(id: string) {
    return this.prisma.client.user.findUnique({
      where: { id },
      include: PHOTOGRAPHER_PROFILE_SUMMARY_INCLUDE,
    });
  }
}
