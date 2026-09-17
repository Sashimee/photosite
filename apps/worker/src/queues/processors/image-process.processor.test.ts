import sharp from 'sharp';
import type { Job } from 'bullmq';
import type { Logger } from 'nestjs-pino';
import { describe, expect, it, vi } from 'vitest';
import { createImageProcessProcessor, type ImageProcessDeps } from './image-process.processor.js';
import type { PutObjectArgs, UploadRow } from './types.js';

const UPLOAD_ID = '3fa85f64-5717-4562-b3fc-2c963f66afa6';

const BASE_UPLOAD: UploadRow = {
  id: UPLOAD_ID,
  ownerId: 'owner-1',
  purpose: 'portfolio',
  status: 'clean',
  mimeType: 'image/jpeg',
  declaredSizeBytes: 1024,
  actualSizeBytes: 1024,
  objectKey: `u/owner-1/${UPLOAD_ID}`,
  virusScanStatus: 'clean',
  expiresAt: null,
};

function fakeJob(): Job<{ uploadId: string }> {
  return { data: { uploadId: UPLOAD_ID } } as unknown as Job<{ uploadId: string }>;
}

function fakeLogger(): Logger {
  return { log: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger;
}

async function fakeJpegBuffer(): Promise<Buffer> {
  return sharp({ create: { width: 400, height: 300, channels: 3, background: 'blue' } })
    .jpeg()
    .toBuffer();
}

function fakeDeps(buffer: Buffer, upload: UploadRow | null = BASE_UPLOAD) {
  const update = vi.fn(() => Promise.resolve(upload ?? BASE_UPLOAD));
  const putObject = vi.fn<(input: PutObjectArgs) => Promise<void>>(() => Promise.resolve());
  const portfolioImageUpdateMany = vi.fn(() => Promise.resolve({ count: 0 }));

  const deps: ImageProcessDeps = {
    prisma: {
      client: {
        upload: { findUnique: vi.fn(() => Promise.resolve(upload)), update },
        $transaction: (fn) =>
          fn({ upload: { update }, portfolioImage: { updateMany: portfolioImageUpdateMany } }),
      },
    },
    storage: {
      config: { privateBucket: 'photoo-private', publicBucket: 'photoo-public' },
      getObjectBuffer: vi.fn(() => Promise.resolve(buffer)),
      putObject,
    },
    maxPixels: 100_000_000,
    logger: fakeLogger(),
  };

  return { deps, update, putObject, portfolioImageUpdateMany };
}

describe('createImageProcessProcessor', () => {
  it('uploads every variant to the public bucket and marks the upload processed', async () => {
    const buffer = await fakeJpegBuffer();
    const { deps, update, putObject } = fakeDeps(buffer);

    await createImageProcessProcessor(deps)(fakeJob(), undefined, undefined);

    expect(putObject).toHaveBeenCalledTimes(6);
    for (const [args] of putObject.mock.calls) {
      expect(args).toMatchObject({ bucket: 'photoo-public' });
    }
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: UPLOAD_ID },
        data: expect.objectContaining({
          status: 'processed',
          width: 400,
          height: 300,
        }) as unknown,
      }),
    );
  });

  it('moves a portfolio image linked to the upload from processing to pending_review', async () => {
    const buffer = await fakeJpegBuffer();
    const { deps, portfolioImageUpdateMany } = fakeDeps(buffer);

    await createImageProcessProcessor(deps)(fakeJob(), undefined, undefined);

    expect(portfolioImageUpdateMany).toHaveBeenCalledWith({
      where: { uploadId: UPLOAD_ID, status: 'processing' },
      data: { status: 'pending_review', width: 400, height: 300 },
    });
  });

  it('marks the upload failed on a magic-byte mismatch instead of throwing', async () => {
    const png = await sharp({ create: { width: 10, height: 10, channels: 3, background: 'red' } })
      .png()
      .toBuffer();
    const { deps, update, putObject } = fakeDeps(png);

    await createImageProcessProcessor(deps)(fakeJob(), undefined, undefined);

    expect(putObject).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith({ where: { id: UPLOAD_ID }, data: { status: 'failed' } });
  });

  it('skips a job whose upload row no longer exists', async () => {
    const buffer = await fakeJpegBuffer();
    const { deps, update } = fakeDeps(buffer, null);

    await createImageProcessProcessor(deps)(fakeJob(), undefined, undefined);

    expect(update).not.toHaveBeenCalled();
  });

  it('refuses to write public variants for a chat attachment', async () => {
    const buffer = await fakeJpegBuffer();
    const { deps, update, putObject } = fakeDeps(buffer, {
      ...BASE_UPLOAD,
      purpose: 'chat_attachment',
    });

    await createImageProcessProcessor(deps)(fakeJob(), undefined, undefined);

    expect(putObject).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('refuses to write public variants for a verification document', async () => {
    const buffer = await fakeJpegBuffer();
    const { deps, update, putObject } = fakeDeps(buffer, {
      ...BASE_UPLOAD,
      purpose: 'verification_document',
    });

    await createImageProcessProcessor(deps)(fakeJob(), undefined, undefined);

    expect(putObject).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
});
