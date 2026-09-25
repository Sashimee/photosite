import { Inject, Injectable } from '@nestjs/common';
import {
  type AdminDataRequestSchema,
  type AdminDataRequestsQuerySchema,
  gdprResponseDueAt,
} from '@photoo/shared';
import type { z } from 'zod';
import {
  decodeAdminDataRequestCursor,
  encodeAdminDataRequestCursor,
} from './admin-data-request-cursor.js';
import {
  AdminDataRequestsRepository,
  type LaterSuccessfulExport,
} from './admin-data-requests.repository.js';
import type { AdminDataRequestRow } from './admin-data-requests.repository.js';

type Query = z.infer<typeof AdminDataRequestsQuerySchema>;
type DataRequestDto = z.infer<typeof AdminDataRequestSchema>;

function isAwaitingResponse(row: AdminDataRequestRow, now: Date): boolean {
  if (row.type !== 'export') {
    return false;
  }
  if (row.status === 'pending' || row.status === 'processing' || row.status === 'failed') {
    return true;
  }
  return row.status === 'ready' && row.expiresAt !== null && row.expiresAt <= now;
}

function buildLatestSuccessByUser(rows: LaterSuccessfulExport[]): Map<string, Date> {
  const latest = new Map<string, Date>();
  for (const row of rows) {
    const current = latest.get(row.userId);
    if (!current || row.requestedAt > current) {
      latest.set(row.userId, row.requestedAt);
    }
  }
  return latest;
}

function responseDueAt(
  row: AdminDataRequestRow,
  now: Date,
  latestSuccessByUser: Map<string, Date>,
): Date | null {
  if (!isAwaitingResponse(row, now)) {
    return null;
  }
  const latestSuccess = latestSuccessByUser.get(row.user.id);
  if (latestSuccess && latestSuccess > row.requestedAt) {
    return null;
  }
  return gdprResponseDueAt(row.requestedAt);
}

function mapDataRequest(
  row: AdminDataRequestRow,
  now: Date,
  latestSuccessByUser: Map<string, Date>,
): DataRequestDto {
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    requestedAt: row.requestedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    failureReason: row.failureReason,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    responseDueAt: responseDueAt(row, now, latestSuccessByUser)?.toISOString() ?? null,
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
      hasMore && last ? encodeAdminDataRequestCursor(last.requestedAt, last.id) : null;

    const now = new Date();
    const awaitingUserIds = [
      ...new Set(page.filter((row) => isAwaitingResponse(row, now)).map((row) => row.user.id)),
    ];
    const laterExports = await this.repository.listSuccessfulExports(awaitingUserIds);
    const latestSuccessByUser = buildLatestSuccessByUser(laterExports);

    return {
      items: page.map((row) => mapDataRequest(row, now, latestSuccessByUser)),
      nextCursor,
    };
  }
}
