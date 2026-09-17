import type { Processor } from 'bullmq';
import type { Logger } from 'nestjs-pino';
import type { ObjectStorage, UploadRepository } from './types.js';

export interface UploadsCleanupDeps {
  prisma: { client: { upload: Pick<UploadRepository, 'findMany' | 'update'> } };
  storage: Pick<ObjectStorage, 'config' | 'deleteObject'>;
  logger: Logger;
}

export function createUploadsCleanupProcessor(deps: UploadsCleanupDeps): Processor {
  return async () => {
    const expired = await deps.prisma.client.upload.findMany({
      where: { status: 'pending_upload', expiresAt: { lt: new Date() } },
    });

    for (const upload of expired) {
      try {
        await deps.storage.deleteObject(deps.storage.config.privateBucket, upload.objectKey);
      } catch (error) {
        deps.logger.warn(
          { err: error, uploadId: upload.id },
          'uploads-cleanup: failed to delete the object, marking failed anyway',
        );
      }
      await deps.prisma.client.upload.update({
        where: { id: upload.id },
        data: { status: 'failed' },
      });
    }

    deps.logger.log({ count: expired.length }, 'uploads-cleanup: swept expired pending uploads');
  };
}
