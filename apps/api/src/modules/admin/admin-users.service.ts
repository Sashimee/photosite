import { HttpException, Inject, Injectable } from '@nestjs/common';
import type { AdminUserSearchQuerySchema, UserRole, UserSchema } from '@photoo/shared';
import type { z } from 'zod';
import { mapUser } from '../auth/user-mapper.js';
import { ChatSocketBridge } from '../chat/chat-socket-bridge.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AdminAuditService } from './admin-audit.service.js';
import { decodeAdminUserCursor, encodeAdminUserCursor } from './admin-user-cursor.js';
import { AdminUsersRepository } from './admin-users.repository.js';

type SearchQuery = z.infer<typeof AdminUserSearchQuerySchema>;
type UserDto = z.infer<typeof UserSchema>;

interface AdminActor {
  id: string;
}

function notFound(): HttpException {
  return new HttpException({ code: 'NOT_FOUND', message: 'User not found' }, 404);
}

function conflict(message: string): HttpException {
  return new HttpException({ code: 'CONFLICT', message }, 409);
}

@Injectable()
export class AdminUsersService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AdminUsersRepository) private readonly repository: AdminUsersRepository,
    @Inject(AdminAuditService) private readonly auditService: AdminAuditService,
    @Inject(ChatSocketBridge) private readonly chatSocketBridge: ChatSocketBridge,
  ) {}

  async search(query: SearchQuery): Promise<{ items: UserDto[]; nextCursor: string | null }> {
    const cursor = query.cursor ? decodeAdminUserCursor(query.cursor) : undefined;
    const rows = await this.repository.search({
      ...(query.q ? { q: query.q } : {}),
      ...(query.role ? { role: query.role } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(cursor ? { cursor } : {}),
      limit: query.limit,
    });

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const last = page[page.length - 1];
    const nextCursor = hasMore && last ? encodeAdminUserCursor(last.createdAt, last.id) : null;

    return { items: page.map(mapUser), nextCursor };
  }

  async get(id: string): Promise<UserDto> {
    const row = await this.repository.findById(id);
    if (!row) {
      throw notFound();
    }
    return mapUser(row);
  }

  async suspend(
    admin: AdminActor,
    id: string,
    reason: string,
    ip: string | undefined,
  ): Promise<UserDto> {
    const existing = await this.repository.findById(id);
    if (!existing) {
      throw notFound();
    }
    if (existing.status !== 'active') {
      throw conflict('User is not active');
    }

    const updated = await this.prisma.client.$transaction(async (tx) => {
      const result = await tx.user.updateMany({
        where: { id, status: 'active' },
        data: { status: 'suspended' },
      });
      if (result.count === 0) {
        throw conflict('User is not active');
      }

      // Suspending an account while its browser tab keeps working is the
      // same class of bug as #101/#127: kill every session, then drop
      // sockets outside the transaction once the change has committed.
      await tx.session.deleteMany({ where: { userId: id } });

      await this.auditService.record(tx, {
        actorId: admin.id,
        action: 'user.suspended',
        targetType: 'User',
        targetId: id,
        before: { status: existing.status },
        after: { status: 'suspended', reason },
        ip: ip ?? null,
      });

      return tx.user.findUniqueOrThrow({ where: { id } });
    });

    this.chatSocketBridge.disconnectUser(id);

    return mapUser(updated);
  }

  async reactivate(admin: AdminActor, id: string, ip: string | undefined): Promise<UserDto> {
    const existing = await this.repository.findById(id);
    if (!existing) {
      throw notFound();
    }
    if (existing.status !== 'suspended') {
      throw conflict('User is not suspended');
    }

    const updated = await this.prisma.client.$transaction(async (tx) => {
      const result = await tx.user.updateMany({
        where: { id, status: 'suspended' },
        data: { status: 'active' },
      });
      if (result.count === 0) {
        throw conflict('User is not suspended');
      }

      await this.auditService.record(tx, {
        actorId: admin.id,
        action: 'user.reactivated',
        targetType: 'User',
        targetId: id,
        before: { status: 'suspended' },
        after: { status: 'active' },
        ip: ip ?? null,
      });

      return tx.user.findUniqueOrThrow({ where: { id } });
    });

    return mapUser(updated);
  }

  async setRoles(
    admin: AdminActor,
    id: string,
    roles: UserRole[],
    ip: string | undefined,
  ): Promise<UserDto> {
    const existing = await this.repository.findById(id);
    if (!existing) {
      throw notFound();
    }

    const removesPhotographer =
      existing.roles.includes('photographer') && !roles.includes('photographer');

    const updated = await this.prisma.client.$transaction(async (tx) => {
      const updatedUser = await tx.user.update({
        where: { id },
        data: { roles: { set: roles } },
      });

      if (removesPhotographer) {
        const profile = await tx.photographerProfile.findUnique({ where: { userId: id } });
        if (profile?.isPublished) {
          await tx.photographerProfile.update({
            where: { id: profile.id },
            data: { isPublished: false },
          });
        }
      }

      await this.auditService.record(tx, {
        actorId: admin.id,
        action: 'user.roles_set',
        targetType: 'User',
        targetId: id,
        before: { roles: existing.roles },
        after: { roles },
        ip: ip ?? null,
      });

      return updatedUser;
    });

    return mapUser(updated);
  }
}
