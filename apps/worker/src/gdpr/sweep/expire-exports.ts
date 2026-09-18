import type { PrismaClient } from '@photoo/db';
import type { Logger } from 'nestjs-pino';
import type { RecordAuditLogInput } from '../../common/audit-log.service.js';

export interface ExpireExportsStorage {
  config: { privateBucket: string };
  deleteObject(bucket: string, key: string): Promise<void>;
}

export interface ExpireExportsDeps {
  prisma: { client: PrismaClient };
  storage: ExpireExportsStorage;
  auditLog: { record(input: RecordAuditLogInput): Promise<void> };
  logger: Logger;
}

export interface ExpireExportsResult {
  exportsExpired: number;
}

// docs/steps/1A.12-gdpr.md "delete expired export objects and clear their
// keys": `DataRequestsService.download` already refuses a download past
// `expiresAt` on its own (410), so this phase only reclaims the object and
// tidies the row; it never changes `status`.
export async function expireExports(deps: ExpireExportsDeps): Promise<ExpireExportsResult> {
  const now = new Date();
  const expired = await deps.prisma.client.dataRequest.findMany({
    where: { type: 'export', status: 'ready', expiresAt: { lte: now }, exportKey: { not: null } },
    select: { id: true, exportKey: true },
  });

  let exportsExpired = 0;
  for (const request of expired) {
    if (!request.exportKey) {
      continue;
    }
    try {
      await deps.storage.deleteObject(deps.storage.config.privateBucket, request.exportKey);
    } catch (error) {
      deps.logger.warn(
        { err: error, dataRequestId: request.id },
        'gdpr-sweep: failed to delete an expired export object, clearing the key anyway',
      );
    }
    await deps.prisma.client.dataRequest.update({
      where: { id: request.id },
      data: { exportKey: null },
    });
    exportsExpired += 1;
  }

  await deps.auditLog.record({
    actorType: 'system',
    actorId: null,
    action: 'gdpr_sweep.exports_expired',
    targetType: 'DataRequest',
    targetId: null,
    after: { exportsExpired },
  });

  deps.logger.log({ exportsExpired }, 'gdpr-sweep: expire-exports phase complete');
  return { exportsExpired };
}
