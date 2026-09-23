import { HttpException } from '@nestjs/common';
import type { Prisma, PrismaClient } from '@photoo/db';
import type { ReportTargetType } from '@photoo/shared';

type ReadClient = PrismaClient | Prisma.TransactionClient;

export async function reportTargetExists(
  client: ReadClient,
  targetType: ReportTargetType,
  targetId: string,
): Promise<boolean> {
  switch (targetType) {
    case 'photographer_profile':
      return (
        (await client.photographerProfile.findUnique({
          where: { id: targetId },
          select: { id: true },
        })) !== null
      );
    case 'portfolio_image':
      return (
        (await client.portfolioImage.findUnique({
          where: { id: targetId },
          select: { id: true },
        })) !== null
      );
    case 'request':
      return (
        (await client.request.findUnique({
          where: { id: targetId },
          select: { id: true },
        })) !== null
      );
    case 'job_offer':
      return (
        (await client.jobOffer.findUnique({
          where: { id: targetId },
          select: { id: true },
        })) !== null
      );
  }
}

function unsupportedTargetType(targetType: string): HttpException {
  return new HttpException(
    { code: 'UNPROCESSABLE_ENTITY', message: `Target type '${targetType}' cannot be taken down` },
    422,
  );
}

// Sets `deletedAt` on the report's target rather than deleting the row
// (docs/steps/1A.11-admin-api.md): a wrong takedown stays reversible and the
// row a future admin read joins against never disappears. `targetType` comes
// from the `Report` row, a free-text column with no foreign key (D23), so it
// is checked at runtime rather than typed as `ReportTargetType` - an older
// or foreign value is a 422, not a crash. Returns false when the target row
// is missing or already taken down, so the caller can tell that apart from
// an actual change.
export async function takeDownReportTarget(
  tx: Prisma.TransactionClient,
  targetType: string,
  targetId: string,
): Promise<boolean> {
  const deletedAt = new Date();
  switch (targetType) {
    case 'photographer_profile': {
      const result = await tx.photographerProfile.updateMany({
        where: { id: targetId, deletedAt: null },
        data: { deletedAt },
      });
      return result.count > 0;
    }
    case 'portfolio_image': {
      const result = await tx.portfolioImage.updateMany({
        where: { id: targetId, deletedAt: null },
        data: { deletedAt },
      });
      return result.count > 0;
    }
    case 'request': {
      const result = await tx.request.updateMany({
        where: { id: targetId, deletedAt: null },
        data: { deletedAt },
      });
      return result.count > 0;
    }
    default:
      throw unsupportedTargetType(targetType);
  }
}
