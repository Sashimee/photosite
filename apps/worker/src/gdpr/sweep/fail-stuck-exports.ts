import type { PrismaClient } from '@photoo/db';
import type { Logger } from 'nestjs-pino';
import type { RecordAuditLogInput } from '../../common/audit-log.service.js';
import type { JobQueueLike } from '../../queues/processors/types.js';
import { notifyExportFailed } from '../notify-export-failed.js';

export interface FailStuckExportsDeps {
  prisma: { client: PrismaClient };
  auditLog: { record(input: RecordAuditLogInput): Promise<void> };
  logger: Logger;
  emailQueue: JobQueueLike;
  webAppUrl: string;
}

export interface FailStuckExportsResult {
  exportsFailed: number;
}

const STUCK_PROCESSING_REASON = 'stuck_processing';
// docs/steps/1A.12-gdpr.md "fail exports stuck in processing for over an
// hour so the user can retry".
const STUCK_THRESHOLD_MS = 60 * 60 * 1000;

export async function failStuckExports(
  deps: FailStuckExportsDeps,
): Promise<FailStuckExportsResult> {
  const cutoff = new Date(Date.now() - STUCK_THRESHOLD_MS);
  const stuckRows = await deps.prisma.client.dataRequest.findMany({
    where: { type: 'export', status: 'processing', updatedAt: { lte: cutoff } },
    select: { id: true, userId: true },
  });

  let exportsFailed = 0;
  for (const row of stuckRows) {
    const updated = await deps.prisma.client.dataRequest.updateMany({
      where: { id: row.id, status: 'processing' },
      data: { status: 'failed', failureReason: STUCK_PROCESSING_REASON },
    });
    if (updated.count !== 1) {
      continue;
    }
    exportsFailed += 1;
    await notifyExportFailed(deps, row.id, row.userId);
  }

  await deps.auditLog.record({
    actorType: 'system',
    actorId: null,
    action: 'gdpr_sweep.exports_failed_stuck',
    targetType: 'DataRequest',
    targetId: null,
    after: { exportsFailed },
  });

  deps.logger.log({ exportsFailed }, 'gdpr-sweep: fail-stuck-exports phase complete');
  return { exportsFailed };
}
