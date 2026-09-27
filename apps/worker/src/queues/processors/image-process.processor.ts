import {
  ImageProcessJobSchema,
  PUBLIC_UPLOAD_PURPOSES,
  type ImageProcessJob,
} from '@photoo/shared';
import type { Job, Processor } from 'bullmq';
import type { Logger } from 'nestjs-pino';
import { processImage } from '../../processing/image-processor.js';
import type { JobQueueLike, ObjectStorage, UploadRepository } from './types.js';

interface ImageProcessTransactionClient {
  upload: Pick<UploadRepository, 'update'>;
  portfolioImage: {
    updateManyAndReturn(args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<{ id: string }[]>;
  };
}

export interface ImageProcessDeps {
  prisma: {
    client: {
      upload: Pick<UploadRepository, 'findUnique' | 'update'>;
      $transaction<T>(fn: (tx: ImageProcessTransactionClient) => Promise<T>): Promise<T>;
    };
  };
  storage: Pick<ObjectStorage, 'config' | 'getObjectBuffer' | 'putObject'>;
  provenanceCheckQueue: JobQueueLike;
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

    if (!(PUBLIC_UPLOAD_PURPOSES as readonly string[]).includes(upload.purpose)) {
      deps.logger.warn(
        { uploadId: upload.id, purpose: upload.purpose },
        'image-process: refusing to write public variants for a non-public purpose',
      );
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

    const portfolioImages = await deps.prisma.client.$transaction(async (tx) => {
      await tx.upload.update({
        where: { id: upload.id },
        data: {
          status: 'processed',
          variants,
          exif: result.exif,
          width: result.width,
          height: result.height,
        },
      });
      return tx.portfolioImage.updateManyAndReturn({
        where: { uploadId: upload.id, status: 'processing' },
        data: { status: 'pending_review', width: result.width, height: result.height },
      });
    });

    const portfolioImageId = portfolioImages[0]?.id;
    if (portfolioImageId) {
      try {
        await deps.provenanceCheckQueue.add(
          'check',
          { portfolioImageId },
          {
            jobId: portfolioImageId,
            attempts: 3,
            backoff: { type: 'exponential', delay: 5000 },
            removeOnComplete: true,
            removeOnFail: 100,
          },
        );
      } catch (error) {
        deps.logger.error(
          { err: error, portfolioImageId },
          'image-process: failed to enqueue a provenance check',
        );
      }
    }
  };
}
