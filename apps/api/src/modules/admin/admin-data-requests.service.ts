import { Inject, Injectable } from '@nestjs/common';
import type { AdminDataRequestSchema, AdminDataRequestsQuerySchema } from '@photoo/shared';
import type { z } from 'zod';
import {
  decodeAdminDataRequestCursor,
  encodeAdminDataRequestCursor,
} from './admin-data-request-cursor.js';
import { AdminDataRequestsRepository } from './admin-data-requests.repository.js';
import type { AdminDataRequestRow } from './admin-data-requests.repository.js';

type Query = z.infer<typeof AdminDataRequestsQuerySchema>;
type DataRequestDto = z.infer<typeof AdminDataRequestSchema>;

function mapDataRequest(row: AdminDataRequestRow): DataRequestDto {
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    requestedAt: row.requestedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    failureReason: row.failureReason,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    user: row.user,
  };
}

@Injectable()
export class AdminDataRequestsService {
  constructor(
    @Inject(AdminDataRequestsRepository) private readonly repository: AdminDataRequestsRepository,
  ) {}

  async list(query: Query): Promise<{ items: DataRequestDto[]; nextCursor: string | null }> {
    const cursor = query.cursor ? decodeAdminDataRequestCursor(query.cursor) : undefined;
    const rows = await this.repository.list({
      ...(query.status ? { status: query.status } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.userId ? { userId: query.userId } : {}),
      ...(cursor ? { cursor } : {}),
      limit: query.limit,
    });

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const last = page[page.length - 1];
    const nextCursor =
      hasMore && last ? encodeAdminDataRequestCursor(new Date(last.requestedAt), last.id) : null;

    return { items: page.map(mapDataRequest), nextCursor };
  }
}
