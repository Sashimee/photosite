import { FileScanJobSchema, type FileScanJob } from '@photoo/shared';
import type { Job, Processor } from 'bullmq';
import type { Logger } from 'nestjs-pino';
import type { RecordAuditLogInput } from '../../common/audit-log.service.js';
import type { ClamdScanOptions } from '../../scanning/clamd-client.js';
import { scanStream } from '../../scanning/clamd-client.js';
import type { JobQueueLike, ObjectStorage, UploadRepository } from './types.js';

export interface FileScanDeps {
  prisma: { client: { upload: Pick<UploadRepository, 'findUnique' | 'update'> } };
  storage: Pick<ObjectStorage, 'config' | 'getObjectStream' | 'deleteObject'>;
  auditLog: { record(input: RecordAuditLogInput): Promise<void> };
  imageProcessQueue: JobQueueLike;
  clamd: ClamdScanOptions;
  logger: Logger;
}

function isFinalAttempt(job: Job): boolean {
  const attempts = job.opts.attempts ?? 1;
  return job.attemptsMade >= attempts;
}

export function createFileScanProcessor(deps: FileScanDeps): Processor<FileScanJob> {
  return async (job: Job<FileScanJob>) => {
    const payload = FileScanJobSchema.parse(job.data);
    const upload = await deps.prisma.client.upload.findUnique({ where: { id: payload.uploadId } });
    if (!upload) {
      deps.logger.warn({ uploadId: payload.uploadId }, 'file-scan: upload not found, skipping');
      return;
    }

    await deps.prisma.client.upload.update({
      where: { id: upload.id },
      data: { status: 'scanning' },
    });

    let result;
    try {
      const stream = await deps.storage.getObjectStream(
        deps.storage.config.privateBucket,
        upload.objectKey,
      );
      result = await scanStream(stream, deps.clamd);
    } catch (error) {
      if (isFinalAttempt(job)) {
        await deps.prisma.client.upload.update({
          where: { id: upload.id },
          data: { status: 'failed' },
        });
      }
      throw error;
    }

    if (result.status === 'infected') {
      await deps.storage.deleteObject(deps.storage.config.privateBucket, upload.objectKey);
      await deps.prisma.client.upload.update({
        where: { id: upload.id },
        data: { status: 'infected', virusScanStatus: 'infected' },
      });
      await deps.auditLog.record({
        actorType: 'system',
        actorId: null,
        action: 'upload.infected',
        targetType: 'Upload',
        targetId: upload.id,
        after: { signature: result.signature },
      });
      return;
    }

    await deps.prisma.client.upload.update({
      where: { id: upload.id },
      data: { status: 'clean', virusScanStatus: 'clean' },
    });

    if (upload.mimeType.startsWith('image/')) {
      await deps.imageProcessQueue.add(
        'process',
        { uploadId: upload.id },
        { removeOnComplete: true, removeOnFail: 100 },
      );
    }
  };
}
