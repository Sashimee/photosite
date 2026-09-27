import type { Job } from 'bullmq';
import type { Logger } from 'nestjs-pino';
import { describe, expect, it, vi } from 'vitest';
import type {
  AiDetectionProvider,
  C2paReader,
  ReverseSearchProvider,
} from '../../provenance/types.js';
import {
  createProvenanceCheckProcessor,
  type PortfolioImageRow,
  type ProvenanceCheckDeps,
  type ProvenanceCheckRow,
} from './provenance-check.processor.js';
import type { UploadRow } from './types.js';

const PORTFOLIO_IMAGE_ID = '3fa85f64-5717-4562-b3fc-2c963f66afa6';
const UPLOAD_ID = 'a1b2c3d4-5717-4562-b3fc-2c963f66afa6';

const BASE_PORTFOLIO_IMAGE: PortfolioImageRow = {
  id: PORTFOLIO_IMAGE_ID,
  uploadId: UPLOAD_ID,
  status: 'pending_review',
};

const BASE_UPLOAD: UploadRow = {
  id: UPLOAD_ID,
  ownerId: 'owner-1',
  purpose: 'portfolio',
  status: 'processed',
  mimeType: 'image/jpeg',
  declaredSizeBytes: 1024,
  actualSizeBytes: 1024,
  objectKey: `u/owner-1/${UPLOAD_ID}`,
  virusScanStatus: 'clean',
  expiresAt: null,
  exif: {
    camera: { make: 'Canon', model: 'EOS R5' },
    capturedAt: '2024-01-01T00:00:00.000Z',
    gps: null,
  },
};

function fakeJob(force?: boolean): Job<{ portfolioImageId: string; force?: boolean }> {
  return {
    data: { portfolioImageId: PORTFOLIO_IMAGE_ID, ...(force !== undefined ? { force } : {}) },
  } as unknown as Job<{ portfolioImageId: string; force?: boolean }>;
}

function fakeLogger(): Logger {
  return { log: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger;
}

function fakeDeps(options: {
  existing?: ProvenanceCheckRow | null;
  portfolioImage?: PortfolioImageRow | null;
  upload?: UploadRow | null;
  detect?: AiDetectionProvider['detect'];
  search?: ReverseSearchProvider['search'];
  read?: C2paReader['read'];
  provenanceEnabled?: boolean;
  provenanceC2paEnabled?: boolean;
}) {
  const portfolioImageRow =
    options.portfolioImage === undefined ? BASE_PORTFOLIO_IMAGE : options.portfolioImage;
  const findUniqueProvenanceCheck = vi.fn(() => Promise.resolve(options.existing ?? null));
  const findUniquePortfolioImage = vi.fn(() => Promise.resolve(portfolioImageRow));
  const findUniqueUpload = vi.fn(() =>
    Promise.resolve(options.upload === undefined ? BASE_UPLOAD : options.upload),
  );
  const portfolioImageUpdateMany = vi.fn((args: { where: { status: string } }) =>
    Promise.resolve({ count: portfolioImageRow?.status === args.where.status ? 1 : 0 }),
  );
  const auditLogCreate = vi.fn(() => Promise.resolve(undefined));
  let nextId = 0;
  const provenanceCheckCreate = vi.fn((args: { data: Record<string, unknown> }) =>
    Promise.resolve({
      id: `check-${String((nextId += 1))}`,
      verdict: args.data.verdict as ProvenanceCheckRow['verdict'],
    }),
  );
  const provenanceCheckUpdate = vi.fn((args: { data: Record<string, unknown> }) =>
    Promise.resolve({
      id: options.existing?.id ?? `check-${String((nextId += 1))}`,
      verdict: args.data.verdict as ProvenanceCheckRow['verdict'],
    }),
  );

  const detect =
    options.detect ??
    vi.fn(() => Promise.resolve({ vendor: 'test-vendor', score: 0.01, raw: null }));
  const search = options.search ?? vi.fn(() => Promise.resolve({ vendor: 'none', matches: [] }));
  const read = options.read ?? vi.fn(() => Promise.resolve({ c2paValid: null }));

  const deps: ProvenanceCheckDeps = {
    prisma: {
      client: {
        provenanceCheck: { findUnique: findUniqueProvenanceCheck },
        portfolioImage: { findUnique: findUniquePortfolioImage },
        upload: { findUnique: findUniqueUpload },
        $transaction: (fn) =>
          fn({
            portfolioImage: { updateMany: portfolioImageUpdateMany },
            provenanceCheck: { create: provenanceCheckCreate, update: provenanceCheckUpdate },
            auditLog: { create: auditLogCreate },
          }),
      },
    },
    aiDetectionProvider: { detect },
    reverseSearchProvider: { search },
    c2paReader: { read },
    provenanceEnabled: options.provenanceEnabled ?? true,
    provenanceC2paEnabled: options.provenanceC2paEnabled ?? false,
    logger: fakeLogger(),
  };

  return {
    deps,
    findUniqueProvenanceCheck,
    findUniquePortfolioImage,
    findUniqueUpload,
    portfolioImageUpdateMany,
    auditLogCreate,
    provenanceCheckCreate,
    provenanceCheckUpdate,
    detect,
    search,
    read,
  };
}

describe('createProvenanceCheckProcessor', () => {
  it('skips a job whose portfolio image already has a check and no force flag', async () => {
    const { deps, provenanceCheckCreate, provenanceCheckUpdate, detect } = fakeDeps({
      existing: { id: 'existing-check', verdict: 'pass' },
    });

    await createProvenanceCheckProcessor(deps)(fakeJob(), undefined, undefined);

    expect(provenanceCheckCreate).not.toHaveBeenCalled();
    expect(provenanceCheckUpdate).not.toHaveBeenCalled();
    expect(detect).not.toHaveBeenCalled();
  });

  it('re-runs and calls providers again when force is set', async () => {
    const { deps, provenanceCheckCreate, provenanceCheckUpdate, detect } = fakeDeps({
      existing: { id: 'existing-check', verdict: 'pass' },
    });

    await createProvenanceCheckProcessor(deps)(fakeJob(true), undefined, undefined);

    expect(detect).toHaveBeenCalledTimes(1);
    expect(provenanceCheckUpdate).toHaveBeenCalledTimes(1);
    expect(provenanceCheckCreate).not.toHaveBeenCalled();
  });

  it('skips a job whose portfolio image row no longer exists', async () => {
    const { deps, findUniqueUpload, provenanceCheckCreate } = fakeDeps({ portfolioImage: null });

    await createProvenanceCheckProcessor(deps)(fakeJob(), undefined, undefined);

    expect(findUniqueUpload).not.toHaveBeenCalled();
    expect(provenanceCheckCreate).not.toHaveBeenCalled();
  });

  it('skips a job whose upload row no longer exists', async () => {
    const { deps, provenanceCheckCreate } = fakeDeps({ upload: null });

    await createProvenanceCheckProcessor(deps)(fakeJob(), undefined, undefined);

    expect(provenanceCheckCreate).not.toHaveBeenCalled();
  });

  it('marks a pass verdict approved and writes an audit log row', async () => {
    const { deps, portfolioImageUpdateMany, auditLogCreate, provenanceCheckCreate } = fakeDeps({});

    await createProvenanceCheckProcessor(deps)(fakeJob(), undefined, undefined);

    expect(provenanceCheckCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ verdict: 'pass' }) as unknown,
      }),
    );
    expect(portfolioImageUpdateMany).toHaveBeenCalledWith({
      where: { id: PORTFOLIO_IMAGE_ID, status: 'pending_review' },
      data: { status: 'approved' },
    });
    expect(auditLogCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorType: 'system',
        action: 'provenance_check.approved',
        targetType: 'ProvenanceCheck',
        after: { verdict: 'pass' },
      }) as unknown,
    });
  });

  it('marks a fail verdict flagged and writes an audit log row, never rejected', async () => {
    const { deps, portfolioImageUpdateMany, auditLogCreate } = fakeDeps({
      detect: vi.fn(() => Promise.resolve({ vendor: 'test-vendor', score: 0.99, raw: null })),
    });

    await createProvenanceCheckProcessor(deps)(fakeJob(), undefined, undefined);

    expect(portfolioImageUpdateMany).toHaveBeenCalledWith({
      where: { id: PORTFOLIO_IMAGE_ID, status: 'pending_review' },
      data: { status: 'flagged' },
    });
    expect(auditLogCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'provenance_check.flagged',
        after: { verdict: 'fail' },
      }) as unknown,
    });
    expect(portfolioImageUpdateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'rejected' } }) as unknown,
    );
  });

  it('leaves status untouched and writes no audit row on a review verdict', async () => {
    const { deps, portfolioImageUpdateMany, auditLogCreate } = fakeDeps({
      detect: vi.fn(() => Promise.resolve({ vendor: 'test-vendor', score: 0.5, raw: null })),
    });

    await createProvenanceCheckProcessor(deps)(fakeJob(), undefined, undefined);

    expect(portfolioImageUpdateMany).not.toHaveBeenCalled();
    expect(auditLogCreate).not.toHaveBeenCalled();
  });

  it('forces a review verdict when a provider fails, even if the raw score would pass', async () => {
    const { deps, portfolioImageUpdateMany, auditLogCreate, provenanceCheckCreate } = fakeDeps({
      detect: vi.fn(() => Promise.reject(new Error('vendor timeout'))),
    });

    await createProvenanceCheckProcessor(deps)(fakeJob(), undefined, undefined);

    expect(provenanceCheckCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ verdict: 'review' }) as unknown }),
    );
    expect(portfolioImageUpdateMany).not.toHaveBeenCalled();
    expect(auditLogCreate).not.toHaveBeenCalled();
  });

  it('does not call the AI or reverse-search providers when provenance is disabled', async () => {
    const { deps, detect, search, provenanceCheckCreate } = fakeDeps({
      provenanceEnabled: false,
    });

    await createProvenanceCheckProcessor(deps)(fakeJob(), undefined, undefined);

    expect(detect).not.toHaveBeenCalled();
    expect(search).not.toHaveBeenCalled();
    expect(provenanceCheckCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ verdict: 'review' }) as unknown }),
    );
  });

  it('does not call the C2PA reader when its flag is disabled', async () => {
    const { deps, read } = fakeDeps({ provenanceC2paEnabled: false });

    await createProvenanceCheckProcessor(deps)(fakeJob(), undefined, undefined);

    expect(read).not.toHaveBeenCalled();
  });

  it('calls the C2PA reader when its flag is enabled', async () => {
    const { deps, read } = fakeDeps({ provenanceC2paEnabled: true });

    await createProvenanceCheckProcessor(deps)(fakeJob(), undefined, undefined);

    expect(read).toHaveBeenCalledTimes(1);
  });

  it('forces a review verdict when the reverse-search provider rejects, even if the raw score would pass', async () => {
    const { deps, portfolioImageUpdateMany, auditLogCreate, provenanceCheckCreate } = fakeDeps({
      search: vi.fn(() => Promise.reject(new Error('vendor unavailable'))),
    });

    await createProvenanceCheckProcessor(deps)(fakeJob(), undefined, undefined);

    expect(provenanceCheckCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ verdict: 'review' }) as unknown }),
    );
    expect(portfolioImageUpdateMany).not.toHaveBeenCalled();
    expect(auditLogCreate).not.toHaveBeenCalled();
  });

  it('forces a review verdict when the C2PA reader rejects, even if the raw score would pass', async () => {
    const { deps, portfolioImageUpdateMany, auditLogCreate, provenanceCheckCreate } = fakeDeps({
      provenanceC2paEnabled: true,
      read: vi.fn(() => Promise.reject(new Error('reader crashed'))),
    });

    await createProvenanceCheckProcessor(deps)(fakeJob(), undefined, undefined);

    expect(provenanceCheckCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ verdict: 'review', c2paValid: null }) as unknown,
      }),
    );
    expect(portfolioImageUpdateMany).not.toHaveBeenCalled();
    expect(auditLogCreate).not.toHaveBeenCalled();
  });

  it('does not downgrade an already-fail verdict when a provider also fails', async () => {
    const { deps, portfolioImageUpdateMany, auditLogCreate, provenanceCheckCreate } = fakeDeps({
      detect: vi.fn(() => Promise.resolve({ vendor: 'test-vendor', score: 0.99, raw: null })),
      search: vi.fn(() => Promise.reject(new Error('vendor unavailable'))),
    });

    await createProvenanceCheckProcessor(deps)(fakeJob(), undefined, undefined);

    expect(provenanceCheckCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ verdict: 'fail' }) as unknown }),
    );
    expect(portfolioImageUpdateMany).toHaveBeenCalledWith({
      where: { id: PORTFOLIO_IMAGE_ID, status: 'pending_review' },
      data: { status: 'flagged' },
    });
    expect(auditLogCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'provenance_check.flagged',
        after: { verdict: 'fail' },
      }) as unknown,
    });
  });

  it('does not overwrite an admin decision when a forced recheck runs', async () => {
    const { deps, portfolioImageUpdateMany, auditLogCreate, provenanceCheckCreate } = fakeDeps({
      portfolioImage: { ...BASE_PORTFOLIO_IMAGE, status: 'approved' },
      existing: { id: 'existing-check-id', verdict: 'pass' },
    });

    await createProvenanceCheckProcessor(deps)(fakeJob(true), undefined, undefined);

    expect(provenanceCheckCreate).not.toHaveBeenCalled();
    expect(portfolioImageUpdateMany).toHaveBeenCalledWith({
      where: { id: PORTFOLIO_IMAGE_ID, status: 'pending_review' },
      data: { status: 'approved' },
    });
    expect(auditLogCreate).not.toHaveBeenCalled();
  });

  it('treats a missing or malformed EXIF blob as no camera and no capture date', async () => {
    const { deps, provenanceCheckCreate } = fakeDeps({
      upload: { ...BASE_UPLOAD, exif: null },
    });

    await createProvenanceCheckProcessor(deps)(fakeJob(), undefined, undefined);

    expect(provenanceCheckCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ exifCamera: null }) as unknown,
      }),
    );
  });

  it('caps an oversized EXIF make/model at 60 chars each and 120 chars overall', async () => {
    const { deps, provenanceCheckCreate } = fakeDeps({
      upload: {
        ...BASE_UPLOAD,
        exif: {
          camera: { make: 'M'.repeat(80), model: 'D'.repeat(80) },
          capturedAt: '2024-01-01T00:00:00.000Z',
          gps: null,
        },
      },
    });

    await createProvenanceCheckProcessor(deps)(fakeJob(), undefined, undefined);

    expect(provenanceCheckCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          exifCamera: `${'M'.repeat(60)} ${'D'.repeat(59)}`,
        }) as unknown,
      }),
    );
  });

  it('persists the full reverse-match objects, not just the domains used for scoring', async () => {
    const matches = [
      { url: 'https://stolen.example/photo.jpg', domain: 'stolen.example', similarity: 0.97 },
    ];
    const { deps, provenanceCheckCreate } = fakeDeps({
      search: vi.fn(() => Promise.resolve({ vendor: 'test-vendor', matches })),
    });

    await createProvenanceCheckProcessor(deps)(fakeJob(), undefined, undefined);

    expect(provenanceCheckCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ reverseMatches: matches }) as unknown,
      }),
    );
  });
});
