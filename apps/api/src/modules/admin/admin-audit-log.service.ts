import { Inject, Injectable } from '@nestjs/common';
import type { AdminAuditLogEntrySchema, AdminAuditLogQuerySchema } from '@photoo/shared';
import type { z } from 'zod';
import { decodeAdminAuditLogCursor, encodeAdminAuditLogCursor } from './admin-audit-log-cursor.js';
import { AdminAuditLogRepository } from './admin-audit-log.repository.js';

type Query = z.infer<typeof AdminAuditLogQuerySchema>;
type EntryDto = z.infer<typeof AdminAuditLogEntrySchema>;

@Injectable()
export class AdminAuditLogService {
  constructor(
    @Inject(AdminAuditLogRepository) private readonly repository: AdminAuditLogRepository,
  ) {}

  async list(query: Query): Promise<{ items: EntryDto[]; nextCursor: string | null }> {
    const cursor = query.cursor ? decodeAdminAuditLogCursor(query.cursor) : undefined;
    const rows = await this.repository.list({
      ...(query.actorId ? { actorId: query.actorId } : {}),
      ...(query.entityType ? { entityType: query.entityType } : {}),
      ...(query.targetId ? { targetId: query.targetId } : {}),
      ...(query.from ? { from: query.from } : {}),
      ...(query.to ? { to: query.to } : {}),
      ...(cursor ? { cursor } : {}),
      limit: query.limit,
    });

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const last = page[page.length - 1];
    const nextCursor = hasMore && last ? encodeAdminAuditLogCursor(last.occurredAt, last.id) : null;

    return {
      items: page.map((row) => ({
        id: row.id,
        actorId: row.actorId,
        action: row.action,
        targetType: row.targetType,
        targetId: row.targetId,
        before: row.before ?? null,
        after: row.after ?? null,
        ip: row.ip,
        occurredAt: row.occurredAt.toISOString(),
      })),
      nextCursor,
    };
  }
}
