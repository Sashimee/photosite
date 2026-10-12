import { Prisma, type PrismaClient } from '@photoo/db';
import type { Logger } from 'nestjs-pino';

export interface ProvenanceRetentionDeps {
  prisma: { client: PrismaClient };
  logger: Logger;
  batchSize?: number;
}

export interface ProvenanceRetentionResult {
  checksDeleted: number;
  checksHeld: number;
  rawCleared: number;
}

export const PROVENANCE_BATCH_SIZE = 500;
// docs/COMPLIANCE.md retention: a passed check's raw vendor payload is cleared
// after 90 days. Measured from createdAt because updatedAt moves on admin review.
const RAW_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

// A takedown resolves the report and soft-deletes the image together, and
// Report.resolution is free text, so any recently resolved report holds the
// evidence. DSA Art. 20 requires a complaint window of at least six months;
// the final value is pending the lawyer.
const TAKEDOWN_HOLD_MS = 180 * 24 * 60 * 60 * 1000;

export interface DeletedImageCandidate {
  checkId: string;
  imageId: string;
  profileId: string;
}

export function selectUnheldChecks(
  candidates: DeletedImageCandidate[],
  openReports: { targetType: string; targetId: string }[],
): { deletable: string[]; held: number } {
  const heldImages = new Set<string>();
  const heldProfiles = new Set<string>();
  for (const report of openReports) {
    if (report.targetType === 'portfolio_image') {
      heldImages.add(report.targetId);
    } else if (report.targetType === 'photographer_profile') {
      heldProfiles.add(report.targetId);
    }
  }
  const deletable: string[] = [];
  let held = 0;
  for (const candidate of candidates) {
    if (heldImages.has(candidate.imageId) || heldProfiles.has(candidate.profileId)) {
      held += 1;
    } else {
      deletable.push(candidate.checkId);
    }
  }
  return { deletable, held };
}

export function rawRetentionCutoff(now: number): Date {
  return new Date(now - RAW_RETENTION_MS);
}

export async function provenanceRetention(
  deps: ProvenanceRetentionDeps,
): Promise<ProvenanceRetentionResult> {
  const { checksDeleted, checksHeld } = await deleteChecksOfDeletedImages(deps);
  const rawCleared = await clearStaleRaw(deps);
  const result = { checksDeleted, checksHeld, rawCleared };
  deps.logger.log(result, 'gdpr-sweep: provenance-retention phase complete');
  return result;
}

async function deleteChecksOfDeletedImages(
  deps: ProvenanceRetentionDeps,
): Promise<{ checksDeleted: number; checksHeld: number }> {
  const db = deps.prisma.client;
  const batchSize = deps.batchSize ?? PROVENANCE_BATCH_SIZE;
  let checksDeleted = 0;
  let checksHeld = 0;
  const holdCutoff = new Date(Date.now() - TAKEDOWN_HOLD_MS);
  let cursor: string | undefined;

  for (;;) {
    const rows = await db.provenanceCheck.findMany({
      where: {
        portfolioImage: { deletedAt: { not: null } },
        ...(cursor === undefined ? {} : { id: { gt: cursor } }),
      },
      select: { id: true, portfolioImageId: true, portfolioImage: { select: { profileId: true } } },
      orderBy: { id: 'asc' },
      take: batchSize,
    });
    if (rows.length === 0) {
      break;
    }
    cursor = rows[rows.length - 1]?.id;

    const candidates = rows.map((row) => ({
      checkId: row.id,
      imageId: row.portfolioImageId,
      profileId: row.portfolioImage.profileId,
    }));
    const openReports = await db.report.findMany({
      where: {
        OR: [{ status: 'open' }, { status: 'resolved', updatedAt: { gt: holdCutoff } }],
        AND: {
          OR: [
            { targetType: 'portfolio_image', targetId: { in: candidates.map((c) => c.imageId) } },
            {
              targetType: 'photographer_profile',
              targetId: { in: candidates.map((c) => c.profileId) },
            },
          ],
        },
      },
      select: { targetType: true, targetId: true },
    });

    const { deletable, held } = selectUnheldChecks(candidates, openReports);
    checksHeld += held;
    if (deletable.length > 0) {
      const deleted = await db.provenanceCheck.deleteMany({ where: { id: { in: deletable } } });
      checksDeleted += deleted.count;
    }
    if (rows.length < batchSize) {
      break;
    }
  }
  return { checksDeleted, checksHeld };
}

async function clearStaleRaw(deps: ProvenanceRetentionDeps): Promise<number> {
  const db = deps.prisma.client;
  const batchSize = deps.batchSize ?? PROVENANCE_BATCH_SIZE;
  const cutoff = rawRetentionCutoff(Date.now());
  let cleared = 0;

  for (;;) {
    const rows = await db.provenanceCheck.findMany({
      where: { verdict: 'pass', createdAt: { lte: cutoff }, raw: { not: Prisma.DbNull } },
      select: { id: true },
      take: batchSize,
    });
    if (rows.length === 0) {
      break;
    }
    const updated = await db.provenanceCheck.updateMany({
      where: { id: { in: rows.map((row) => row.id) } },
      data: { raw: Prisma.DbNull },
    });
    cleared += updated.count;
    if (rows.length < batchSize) {
      break;
    }
  }
  return cleared;
}
