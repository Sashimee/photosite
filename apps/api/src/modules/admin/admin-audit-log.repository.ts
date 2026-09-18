import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@photoo/db';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { AdminAuditLogCursor } from './admin-audit-log-cursor.js';

export interface AdminAuditLogFilters {
  actorId?: string;
  entityType?: string;
  targetId?: string;
  from?: string;
  to?: string;
  cursor?: AdminAuditLogCursor;
  limit: number;
}

// Newest first, so the cursor walks strictly backward in time.
function cursorWhere(cursor: AdminAuditLogCursor): Prisma.AuditLogWhereInput {
  const occurredAt = new Date(cursor.occurredAt);
  return {
    OR: [{ occurredAt: { lt: occurredAt } }, { occurredAt, id: { lt: cursor.id } }],
  };
}

@Injectable()
export class AdminAuditLogRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(filters: AdminAuditLogFilters) {
    const and: Prisma.AuditLogWhereInput[] = [];
    if (filters.actorId) {
      and.push({ actorId: filters.actorId });
    }
    if (filters.entityType) {
      and.push({ targetType: filters.entityType });
    }
    if (filters.targetId) {
      and.push({ targetId: filters.targetId });
    }
    if (filters.from) {
      and.push({ occurredAt: { gte: new Date(filters.from) } });
    }
    if (filters.to) {
      and.push({ occurredAt: { lte: new Date(filters.to) } });
    }
    if (filters.cursor) {
      and.push(cursorWhere(filters.cursor));
    }
    const where: Prisma.AuditLogWhereInput = and.length > 0 ? { AND: and } : {};

    return this.prisma.client.auditLog.findMany({
      where,
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: filters.limit + 1,
    });
  }
}
