import { Readable } from 'node:stream';
import type { Job } from 'bullmq';
import type { Logger } from 'nestjs-pino';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { eicarTestString } from '../../testing/eicar.js';
import { startFakeClamdServer, type FakeClamdServer } from '../../testing/fake-clamd-server.js';
import { createFileScanProcessor, type FileScanDeps } from './file-scan.processor.js';
import type { UploadRow } from './types.js';

const UPLOAD_ID = '3fa85f64-5717-4562-b3fc-2c963f66afa6';

const BASE_UPLOAD: UploadRow = {
  id: UPLOAD_ID,
  ownerId: 'owner-1',
  purpose: 'portfolio',
  status: 'uploaded',
  mimeType: 'image/jpeg',
  declaredSizeBytes: 1024,
  actualSizeBytes: 1024,
  objectKey: `u/owner-1/${UPLOAD_ID}`,
  virusScanStatus: 'pending',
  expiresAt: null,
};

function fakeJob(attemptsMade = 1, attempts = 1): Job<{ uploadId: string }> {
  return {
    data: { uploadId: UPLOAD_ID },
    attemptsMade,
    opts: { attempts },
  } as unknown as Job<{ uploadId: string }>;
}

function fakeLogger(): Logger {
  return { log: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger;
}

interface TestDeps extends FileScanDeps {
  update: ReturnType<
    typeof vi.fn<
      (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<UploadRow>
    >
  >;
  deleteObject: ReturnType<typeof vi.fn<(bucket: string, key: string) => Promise<void>>>;
  auditRecord: ReturnType<typeof vi.fn>;
  enqueue: ReturnType<typeof vi.fn>;
}

function fakeDeps(overrides: { upload?: UploadRow | null; clamdPort: number }): TestDeps {
  const upload = overrides.upload === undefined ? BASE_UPLOAD : overrides.upload;
  const update = vi.fn<
    (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<UploadRow>
  >(() => Promise.resolve(upload ?? BASE_UPLOAD));
  const deleteObject = vi.fn<(bucket: string, key: string) => Promise<void>>(() =>
    Promise.resolve(),
  );
  const auditRecord = vi.fn(() => Promise.resolve());
  const enqueue = vi.fn(() => Promise.resolve());
  const findUnique = vi.fn(() => Promise.resolve(upload));
  const getObjectStream = vi.fn(() =>
    Promise.resolve(Readable.from([Buffer.from('file contents')])),
  );

  return {
    prisma: { client: { upload: { findUnique, update } } },
    storage: {
      config: { privateBucket: 'photoo-private', publicBucket: 'photoo-public' },
      getObjectStream,
      deleteObject,
    },
    auditLog: { record: auditRecord },
    imageProcessQueue: { add: enqueue },
    clamd: { host: '127.0.0.1', port: overrides.clamdPort, maxBytes: 1024 * 1024, timeoutMs: 2000 },
    logger: fakeLogger(),
    update,
    deleteObject,
    auditRecord,
    enqueue,
  };
}

describe('createFileScanProcessor', () => {
  let server: FakeClamdServer | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it('marks a clean, non-image upload clean without enqueueing image-process', async () => {
    server = await startFakeClamdServer(() => 'stream: OK\0');
    const deps = fakeDeps({
      clamdPort: server.port,
      upload: { ...BASE_UPLOAD, mimeType: 'application/pdf' },
    });
    const processor = createFileScanProcessor(deps);

    await processor(fakeJob(), undefined, undefined);

    expect(deps.update).toHaveBeenCalledWith({
      where: { id: UPLOAD_ID },
      data: { status: 'scanning' },
    });
    expect(deps.update).toHaveBeenCalledWith({
      where: { id: UPLOAD_ID },
      data: { status: 'clean', virusScanStatus: 'clean' },
    });
    expect(deps.enqueue).not.toHaveBeenCalled();
  });

  it('marks a clean image upload clean and enqueues image-process', async () => {
    server = await startFakeClamdServer(() => 'stream: OK\0');
    const deps = fakeDeps({ clamdPort: server.port });
    const processor = createFileScanProcessor(deps);

    await processor(fakeJob(), undefined, undefined);

    expect(deps.enqueue).toHaveBeenCalledWith(
      'process',
      { uploadId: UPLOAD_ID },
      expect.objectContaining({ removeOnComplete: true }),
    );
  });

  it('marks a clean chat attachment image clean without enqueueing image-process', async () => {
    server = await startFakeClamdServer(() => 'stream: OK\0');
    const deps = fakeDeps({
      clamdPort: server.port,
      upload: { ...BASE_UPLOAD, purpose: 'chat_attachment' },
    });
    const processor = createFileScanProcessor(deps);

    await processor(fakeJob(), undefined, undefined);

    expect(deps.update).toHaveBeenCalledWith({
      where: { id: UPLOAD_ID },
      data: { status: 'clean', virusScanStatus: 'clean' },
    });
    expect(deps.enqueue).not.toHaveBeenCalled();
  });

  it('marks a clean verification document image clean without enqueueing image-process', async () => {
    server = await startFakeClamdServer(() => 'stream: OK\0');
    const deps = fakeDeps({
      clamdPort: server.port,
      upload: { ...BASE_UPLOAD, purpose: 'verification_document' },
    });
    const processor = createFileScanProcessor(deps);

    await processor(fakeJob(), undefined, undefined);

    expect(deps.enqueue).not.toHaveBeenCalled();
  });

  it('deletes the object, marks infected and writes an AuditLog row on a FOUND reply', async () => {
    server = await startFakeClamdServer(() => 'stream: Eicar-Signature FOUND\0');
    const deps = fakeDeps({ clamdPort: server.port });
    const processor = createFileScanProcessor(deps);

    await processor(fakeJob(), undefined, undefined);

    expect(deps.deleteObject).toHaveBeenCalledWith('photoo-private', BASE_UPLOAD.objectKey);
    expect(deps.update).toHaveBeenCalledWith({
      where: { id: UPLOAD_ID },
      data: { status: 'infected', virusScanStatus: 'infected' },
    });
    expect(deps.auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        actorType: 'system',
        action: 'upload.infected',
        targetType: 'Upload',
        targetId: UPLOAD_ID,
      }),
    );
  });

  it('skips a job whose upload row no longer exists', async () => {
    const deps = fakeDeps({ clamdPort: 1, upload: null });
    const processor = createFileScanProcessor(deps);

    await processor(fakeJob(), undefined, undefined);

    expect(deps.update).not.toHaveBeenCalled();
  });

  it('marks failed only on the final attempt when clamd is unreachable', async () => {
    const notFinal = fakeDeps({ clamdPort: 1 });
    await expect(
      createFileScanProcessor(notFinal)(fakeJob(1, 3), undefined, undefined as never),
    ).rejects.toThrow();
    expect(notFinal.update).not.toHaveBeenCalledWith({
      where: { id: UPLOAD_ID },
      data: { status: 'failed' },
    });

    const final = fakeDeps({ clamdPort: 1 });
    await expect(
      createFileScanProcessor(final)(fakeJob(3, 3), undefined, undefined as never),
    ).rejects.toThrow();
    expect(final.update).toHaveBeenCalledWith({
      where: { id: UPLOAD_ID },
      data: { status: 'failed' },
    });
  });

  it('scans a real EICAR payload end to end against the fake clamd', async () => {
    server = await startFakeClamdServer((payload) =>
      payload.toString('utf8').includes(eicarTestString())
        ? 'stream: Eicar FOUND\0'
        : 'stream: OK\0',
    );
    const deps = fakeDeps({ clamdPort: server.port });
    deps.storage.getObjectStream = vi.fn(() =>
      Promise.resolve(Readable.from([Buffer.from(eicarTestString())])),
    );
    const processor = createFileScanProcessor(deps);

    await processor(fakeJob(), undefined, undefined);

    expect(deps.deleteObject).toHaveBeenCalled();
  });
});
