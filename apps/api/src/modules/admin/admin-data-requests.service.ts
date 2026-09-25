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
  type AdminDataRequestRow,
  AdminDataRequestsRepository,
  type SuccessfulExport,
} from './admin-data-requests.repository.js';

type Query = z.infer<typeof AdminDataRequestsQuerySchema>;
type DataRequestDto = z.infer<typeof AdminDataRequestSchema>;

// A `ready` export answered the request even once its download link has
// expired, so only exports that never produced a copy are still awaiting one.
function isAwaitingResponse(row: AdminDataRequestRow): boolean {
  return (
    row.type === 'export' &&
    (row.status === 'pending' || row.status === 'processing' || row.status === 'failed')
  );
}

function buildLatestSuccessByUser(rows: SuccessfulExport[]): Map<string, Date> {
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
  latestSuccessByUser: Map<string, Date>,
): Date | null {
  if (!isAwaitingResponse(row)) {
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
    responseDueAt: responseDueAt(row, latestSuccessByUser)?.toISOString() ?? null,
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

    const awaitingUserIds = [
      ...new Set(page.filter((row) => isAwaitingResponse(row)).map((row) => row.user.id)),
    ];
    const successfulExports = await this.repository.listSuccessfulExports(awaitingUserIds);
    const latestSuccessByUser = buildLatestSuccessByUser(successfulExports);

    return {
      items: page.map((row) => mapDataRequest(row, latestSuccessByUser)),
      nextCursor,
    };
  }
}
