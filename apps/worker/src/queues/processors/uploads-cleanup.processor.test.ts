import type { Job } from 'bullmq';
import type { Logger } from 'nestjs-pino';
import { describe, expect, it, vi } from 'vitest';
import {
  createUploadsCleanupProcessor,
  type UploadsCleanupDeps,
} from './uploads-cleanup.processor.js';
import type { UploadRow } from './types.js';

// The repeatable sweep job carries no payload of its own (see
// UploadsCleanupJobSchema), so the processor never reads its `job` argument.
const FAKE_JOB = {} as Job;

function fakeLogger(): Logger {
  return { log: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger;
}

function upload(id: string): UploadRow {
  return {
    id,
    ownerId: 'owner-1',
    purpose: 'portfolio',
    status: 'pending_upload',
    mimeType: 'image/jpeg',
    declaredSizeBytes: 1024,
    actualSizeBytes: null,
    objectKey: `u/owner-1/${id}`,
    virusScanStatus: 'pending',
    expiresAt: new Date('2020-01-01T00:00:00.000Z'),
  };
}

describe('createUploadsCleanupProcessor', () => {
  it('deletes the object and marks every expired pending upload failed', async () => {
    const uploadA = upload('a');
    const uploadB = upload('b');
    const update = vi.fn(() => Promise.resolve(uploadA));
    const deleteObject = vi.fn(() => Promise.resolve());
    const deps: UploadsCleanupDeps = {
      prisma: {
        client: { upload: { findMany: vi.fn(() => Promise.resolve([uploadA, uploadB])), update } },
      },
      storage: {
        config: { privateBucket: 'photoo-private', publicBucket: 'photoo-public' },
        deleteObject,
      },
      logger: fakeLogger(),
    };

    await createUploadsCleanupProcessor(deps)(FAKE_JOB, undefined, undefined);

    expect(deleteObject).toHaveBeenCalledWith('photoo-private', 'u/owner-1/a');
    expect(deleteObject).toHaveBeenCalledWith('photoo-private', 'u/owner-1/b');
    expect(update).toHaveBeenCalledWith({ where: { id: 'a' }, data: { status: 'failed' } });
    expect(update).toHaveBeenCalledWith({ where: { id: 'b' }, data: { status: 'failed' } });
  });

  it('still marks the row failed when the object was already gone', async () => {
    const uploadC = upload('c');
    const update = vi.fn(() => Promise.resolve(uploadC));
    const deleteObject = vi.fn(() => Promise.reject(new Error('NoSuchKey')));
    const deps: UploadsCleanupDeps = {
      prisma: { client: { upload: { findMany: vi.fn(() => Promise.resolve([uploadC])), update } } },
      storage: {
        config: { privateBucket: 'photoo-private', publicBucket: 'photoo-public' },
        deleteObject,
      },
      logger: fakeLogger(),
    };

    await createUploadsCleanupProcessor(deps)(FAKE_JOB, undefined, undefined);

    expect(update).toHaveBeenCalledWith({ where: { id: 'c' }, data: { status: 'failed' } });
  });

  it('does nothing when there is nothing expired', async () => {
    const update = vi.fn(() => Promise.resolve(upload('x')));
    const deleteObject = vi.fn(() => Promise.resolve());
    const deps: UploadsCleanupDeps = {
      prisma: { client: { upload: { findMany: vi.fn(() => Promise.resolve([])), update } } },
      storage: {
        config: { privateBucket: 'photoo-private', publicBucket: 'photoo-public' },
        deleteObject,
      },
      logger: fakeLogger(),
    };

    await createUploadsCleanupProcessor(deps)(FAKE_JOB, undefined, undefined);

    expect(update).not.toHaveBeenCalled();
    expect(deleteObject).not.toHaveBeenCalled();
  });
});
