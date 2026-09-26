import {
  computeProvenanceScore,
  ProvenanceCheckJobSchema,
  type ProvenanceCheckJob,
  type ProvenanceReverseMatchSignal,
  type ProvenanceSignals,
  type ProvenanceVerdict,
} from '@photoo/shared';
import type { Job, Processor } from 'bullmq';
import type { Logger } from 'nestjs-pino';
import type { ExtractedExif } from '../../processing/exif-extractor.js';
import type {
  AiDetectionProvider,
  C2paReader,
  ReverseSearchProvider,
} from '../../provenance/types.js';
import type { UploadRepository } from './types.js';

const PROVIDER_TIMEOUT_MS = 15_000;

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer!: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`timed out after ${String(ms)}ms`));
    }, ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function formatExifCamera(
  camera: { make: string | null; model: string | null } | null,
): string | null {
  if (!camera) {
    return null;
  }
  const label = [camera.make, camera.model]
    .filter((part): part is string => Boolean(part))
    .join(' ');
  return label.length > 0 ? label : null;
}

function parseExifCapturedAt(capturedAt: string | null | undefined): Date | null {
  if (!capturedAt) {
    return null;
  }
  const date = new Date(capturedAt);
  return Number.isNaN(date.getTime()) ? null : date;
}

function asExtractedExif(raw: unknown): ExtractedExif | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  const value = raw as Partial<ExtractedExif>;
  return {
    camera: value.camera ?? null,
    capturedAt: typeof value.capturedAt === 'string' ? value.capturedAt : null,
    gps: value.gps ?? null,
  };
}

export interface PortfolioImageRow {
  id: string;
  uploadId: string;
  status: string;
}

export interface ProvenanceCheckRow {
  id: string;
  verdict: ProvenanceVerdict;
}

export interface ProvenanceCheckTransactionClient {
  portfolioImage: {
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
  };
  provenanceCheck: {
    create(args: { data: Record<string, unknown> }): Promise<ProvenanceCheckRow>;
    update(args: {
      where: { portfolioImageId: string };
      data: Record<string, unknown>;
    }): Promise<ProvenanceCheckRow>;
  };
  auditLog: { create(args: { data: Record<string, unknown> }): Promise<unknown> };
}

export interface ProvenanceCheckDeps {
  prisma: {
    client: {
      provenanceCheck: {
        findUnique(args: {
          where: { portfolioImageId: string };
        }): Promise<ProvenanceCheckRow | null>;
      };
      portfolioImage: {
        findUnique(args: { where: { id: string } }): Promise<PortfolioImageRow | null>;
      };
      upload: Pick<UploadRepository, 'findUnique'>;
      $transaction<T>(fn: (tx: ProvenanceCheckTransactionClient) => Promise<T>): Promise<T>;
    };
  };
  aiDetectionProvider: AiDetectionProvider;
  reverseSearchProvider: ReverseSearchProvider;
  c2paReader: C2paReader;
  provenanceEnabled: boolean;
  provenanceC2paEnabled: boolean;
  logger: Logger;
}

const VERDICT_STATUS: Partial<Record<ProvenanceVerdict, 'approved' | 'flagged'>> = {
  pass: 'approved',
  fail: 'flagged',
};

export function createProvenanceCheckProcessor(
  deps: ProvenanceCheckDeps,
): Processor<ProvenanceCheckJob> {
  return async (job: Job<ProvenanceCheckJob>) => {
    const payload = ProvenanceCheckJobSchema.parse(job.data);

    const existing = await deps.prisma.client.provenanceCheck.findUnique({
      where: { portfolioImageId: payload.portfolioImageId },
    });
    if (existing && !payload.force) {
      deps.logger.log(
        { portfolioImageId: payload.portfolioImageId },
        'provenance-check: already checked, skipping',
      );
      return;
    }

    const portfolioImage = await deps.prisma.client.portfolioImage.findUnique({
      where: { id: payload.portfolioImageId },
    });
    if (!portfolioImage) {
      deps.logger.warn(
        { portfolioImageId: payload.portfolioImageId },
        'provenance-check: portfolio image not found, skipping',
      );
      return;
    }

    const upload = await deps.prisma.client.upload.findUnique({
      where: { id: portfolioImage.uploadId },
    });
    if (!upload) {
      deps.logger.warn(
        { portfolioImageId: payload.portfolioImageId, uploadId: portfolioImage.uploadId },
        'provenance-check: upload not found, skipping',
      );
      return;
    }

    const imageRef = { portfolioImageId: payload.portfolioImageId };
    let providerFailed = false;

    let aiScore: number | null = null;
    let aiVendor = 'none';
    let aiRaw: unknown = null;
    let reverseMatches: { url: string; domain: string; similarity: number }[] = [];
    let reverseVendor = 'none';

    if (deps.provenanceEnabled) {
      try {
        const detection = await withTimeout(
          deps.aiDetectionProvider.detect(imageRef),
          PROVIDER_TIMEOUT_MS,
        );
        aiScore = detection.score;
        aiVendor = detection.vendor;
        aiRaw = detection.raw;
      } catch (error) {
        providerFailed = true;
        deps.logger.warn(
          { err: error, portfolioImageId: payload.portfolioImageId },
          'provenance-check: AI detection provider failed',
        );
      }

      try {
        const reverse = await withTimeout(
          deps.reverseSearchProvider.search(imageRef),
          PROVIDER_TIMEOUT_MS,
        );
        reverseMatches = reverse.matches;
        reverseVendor = reverse.vendor;
      } catch (error) {
        providerFailed = true;
        deps.logger.warn(
          { err: error, portfolioImageId: payload.portfolioImageId },
          'provenance-check: reverse search provider failed',
        );
      }
    }

    let c2paValid: boolean | null = null;
    if (deps.provenanceC2paEnabled) {
      try {
        const c2pa = await withTimeout(deps.c2paReader.read(imageRef), PROVIDER_TIMEOUT_MS);
        c2paValid = c2pa.c2paValid;
      } catch (error) {
        providerFailed = true;
        deps.logger.warn(
          { err: error, portfolioImageId: payload.portfolioImageId },
          'provenance-check: C2PA reader failed',
        );
      }
    }

    const exif = asExtractedExif(upload.exif);
    const hasExifCamera = exif ? exif.camera !== null : null;
    const exifCamera = exif ? formatExifCamera(exif.camera) : null;
    const exifCapturedAt = exif ? parseExifCapturedAt(exif.capturedAt) : null;

    // The scoring function only reasons about domains; the full match
    // objects (url, similarity) are kept for the DB column and for admin
    // review, not for the score itself.
    const reverseSignal: readonly ProvenanceReverseMatchSignal[] | null =
      reverseVendor === 'none' ? null : reverseMatches.map((match) => ({ domain: match.domain }));

    const signals: ProvenanceSignals = {
      aiScore,
      reverseMatches: reverseSignal,
      c2paValid,
      hasExifCamera,
      exifCapturedAt,
    };

    const scored = computeProvenanceScore(signals);
    const verdict: ProvenanceVerdict =
      providerFailed && scored.verdict !== 'fail' ? 'review' : scored.verdict;

    const check = await deps.prisma.client.$transaction(async (tx) => {
      const data = {
        aiScore,
        aiVendor,
        reverseMatches,
        c2paValid,
        exifCamera,
        exifCapturedAt,
        score: scored.score,
        verdict,
        raw: aiRaw,
      };
      const check = existing
        ? await tx.provenanceCheck.update({
            where: { portfolioImageId: payload.portfolioImageId },
            data,
          })
        : await tx.provenanceCheck.create({
            data: { portfolioImageId: payload.portfolioImageId, ...data },
          });

      const status = VERDICT_STATUS[verdict];
      if (status) {
        await tx.portfolioImage.update({
          where: { id: payload.portfolioImageId },
          data: { status },
        });
        await tx.auditLog.create({
          data: {
            actorType: 'system',
            actorId: null,
            action: `provenance_check.${status}`,
            targetType: 'ProvenanceCheck',
            targetId: check.id,
            after: { verdict },
          },
        });
      }

      return check;
    });

    deps.logger.log(
      { portfolioImageId: payload.portfolioImageId, provenanceCheckId: check.id, verdict },
      'provenance-check: recorded',
    );
  };
}
