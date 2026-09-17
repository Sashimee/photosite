import { ImageProcessJobSchema, type ImageProcessJob } from '@photoo/shared';
import type { Job, Processor } from 'bullmq';
import type { Logger } from 'nestjs-pino';
import { processImage } from '../../processing/image-processor.js';
import type { ObjectStorage, UploadRepository } from './types.js';

export interface ImageProcessDeps {
  prisma: { client: { upload: Pick<UploadRepository, 'findUnique' | 'update'> } };
  storage: Pick<ObjectStorage, 'config' | 'getObjectBuffer' | 'putObject'>;
  maxPixels: number;
  logger: Logger;
}

const VARIANT_CONTENT_TYPES = { jpeg: 'image/jpeg', webp: 'image/webp' } as const;

export function createImageProcessProcessor(deps: ImageProcessDeps): Processor<ImageProcessJob> {
  return async (job: Job<ImageProcessJob>) => {
    const payload = ImageProcessJobSchema.parse(job.data);
    const upload = await deps.prisma.client.upload.findUnique({ where: { id: payload.uploadId } });
    if (!upload) {
      deps.logger.warn({ uploadId: payload.uploadId }, 'image-process: upload not found, skipping');
      return;
    }

    const buffer = await deps.storage.getObjectBuffer(
      deps.storage.config.privateBucket,
      upload.objectKey,
    );

    let result;
    try {
      result = await processImage({
        buffer,
        declaredMimeType: upload.mimeType,
        maxPixels: deps.maxPixels,
      });
    } catch (error) {
      deps.logger.warn({ err: error, uploadId: upload.id }, 'image-process: rejecting image');
      await deps.prisma.client.upload.update({
        where: { id: upload.id },
        data: { status: 'failed' },
      });
      return;
    }

    for (const variant of result.variants) {
      await deps.storage.putObject({
        bucket: deps.storage.config.publicBucket,
        key: variant.key,
        body: variant.buffer,
        contentType: VARIANT_CONTENT_TYPES[variant.format],
      });
    }

    const variants = Object.fromEntries(
      result.variants.map((variant) => [`${variant.name}_${variant.format}`, variant.key]),
    );

    await deps.prisma.client.upload.update({
      where: { id: upload.id },
      data: { status: 'processed', variants, exif: result.exif },
    });
  };
}
