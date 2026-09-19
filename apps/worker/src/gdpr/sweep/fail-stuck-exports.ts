import type { PrismaClient } from '@photoo/db';
import type { Logger } from 'nestjs-pino';
import type { RecordAuditLogInput } from '../../common/audit-log.service.js';

export interface FailStuckExportsDeps {
  prisma: { client: PrismaClient };
  auditLog: { record(input: RecordAuditLogInput): Promise<void> };
  logger: Logger;
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
  const result = await deps.prisma.client.dataRequest.updateMany({
    where: { type: 'export', status: 'processing', updatedAt: { lte: cutoff } },
    data: { status: 'failed', failureReason: STUCK_PROCESSING_REASON },
  });

  await deps.auditLog.record({
    actorType: 'system',
    actorId: null,
    action: 'gdpr_sweep.exports_failed_stuck',
    targetType: 'DataRequest',
    targetId: null,
    after: { exportsFailed: result.count },
  });

  deps.logger.log({ exportsFailed: result.count }, 'gdpr-sweep: fail-stuck-exports phase complete');
  return { exportsFailed: result.count };
}
