import { HttpException } from '@nestjs/common';
import type { Prisma, PrismaClient } from '@photoo/db';
import type { AdminReportTargetSchema, ReportTargetType } from '@photoo/shared';
import type { z } from 'zod';
import { PORTFOLIO_VARIANT_KEY, uploadVariants } from '../profiles/profile-mapper.js';
import { publicVariantUrl } from '../../storage/public-url.js';

type ReadClient = PrismaClient | Prisma.TransactionClient;
type ReportTargetSummary = z.infer<typeof AdminReportTargetSchema>;

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
    case 'job_application':
      return (
        (await client.jobApplication.findUnique({
          where: { id: targetId },
          select: { id: true },
        })) !== null
      );
  }
}

function unsupportedTargetType(targetType: string, action: string): HttpException {
  return new HttpException(
    {
      code: 'UNPROCESSABLE_ENTITY',
      message: `Target type '${targetType}' cannot be ${action}`,
    },
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
    case 'job_offer': {
      const result = await tx.jobOffer.updateMany({
        where: { id: targetId, deletedAt: null },
        data: { deletedAt },
      });
      return result.count > 0;
    }
    case 'job_application': {
      const result = await tx.jobApplication.updateMany({
        where: { id: targetId, deletedAt: null },
        data: { deletedAt },
      });
      return result.count > 0;
    }
    default:
      throw unsupportedTargetType(targetType, 'taken down');
  }
}

// Mirrors `takeDownReportTarget`: clears `deletedAt` instead of setting it,
// only where it is currently set, so restoring a target that was never
// taken down is a no-op the caller reports as a 409, not a silent success.
export async function restoreReportTarget(
  tx: Prisma.TransactionClient,
  targetType: string,
  targetId: string,
): Promise<boolean> {
  switch (targetType) {
    case 'photographer_profile': {
      const result = await tx.photographerProfile.updateMany({
        where: { id: targetId, deletedAt: { not: null } },
        data: { deletedAt: null },
      });
      return result.count > 0;
    }
    case 'portfolio_image': {
      const result = await tx.portfolioImage.updateMany({
        where: { id: targetId, deletedAt: { not: null } },
        data: { deletedAt: null },
      });
      return result.count > 0;
    }
    case 'request': {
      const result = await tx.request.updateMany({
        where: { id: targetId, deletedAt: { not: null } },
        data: { deletedAt: null },
      });
      return result.count > 0;
    }
    case 'job_offer': {
      const result = await tx.jobOffer.updateMany({
        where: { id: targetId, deletedAt: { not: null } },
        data: { deletedAt: null },
      });
      return result.count > 0;
    }
    case 'job_application': {
      const result = await tx.jobApplication.updateMany({
        where: { id: targetId, deletedAt: { not: null } },
        data: { deletedAt: null },
      });
      return result.count > 0;
    }
    default:
      throw unsupportedTargetType(targetType, 'restored');
  }
}

// Each branch selects only what a moderator needs to decide, never the
// reporting user or the target owner's email (docs/steps/1D.6-moderation.md).
export async function buildReportTargetSummary(
  client: ReadClient,
  targetType: string,
  targetId: string,
  baseUrl: string,
): Promise<ReportTargetSummary | null> {
  switch (targetType) {
    case 'photographer_profile': {
      const profile = await client.photographerProfile.findUnique({
        where: { id: targetId },
        select: { displayName: true, slug: true, isPublished: true, deletedAt: true },
      });
      if (!profile) {
        return null;
      }
      return {
        targetType: 'photographer_profile',
        displayName: profile.displayName,
        slug: profile.slug,
        isPublished: profile.isPublished,
        deletedAt: profile.deletedAt?.toISOString() ?? null,
      };
    }
    case 'portfolio_image': {
      const image = await client.portfolioImage.findUnique({
        where: { id: targetId },
        include: { upload: true },
      });
      if (!image) {
        return null;
      }
      return {
        targetType: 'portfolio_image',
        url: publicVariantUrl(baseUrl, uploadVariants(image.upload), PORTFOLIO_VARIANT_KEY),
        width: image.width,
        height: image.height,
        status: image.status,
        deletedAt: image.deletedAt?.toISOString() ?? null,
      };
    }
    case 'request': {
      const request = await client.request.findUnique({
        where: { id: targetId },
        select: { title: true, description: true, deletedAt: true },
      });
      if (!request) {
        return null;
      }
      return {
        targetType: 'request',
        title: request.title,
        description: request.description,
        deletedAt: request.deletedAt?.toISOString() ?? null,
      };
    }
    case 'job_offer': {
      const offer = await client.jobOffer.findUnique({
        where: { id: targetId },
        select: {
          title: true,
          description: true,
          deletedAt: true,
          professional: { select: { companyName: true } },
        },
      });
      if (!offer) {
        return null;
      }
      return {
        targetType: 'job_offer',
        title: offer.title,
        description: offer.description,
        companyName: offer.professional.companyName,
        deletedAt: offer.deletedAt?.toISOString() ?? null,
      };
    }
    case 'job_application': {
      const application = await client.jobApplication.findUnique({
        where: { id: targetId },
        select: {
          message: true,
          deletedAt: true,
          jobOffer: { select: { title: true } },
        },
      });
      if (!application) {
        return null;
      }
      return {
        targetType: 'job_application',
        message: application.message,
        jobOfferTitle: application.jobOffer.title,
        deletedAt: application.deletedAt?.toISOString() ?? null,
      };
    }
    default:
      return null;
  }
}

// The user a decision notice goes to besides the reporter. Null alongside
// a missing target summary means there is nobody left to notify, not an
// error - the row is gone or the type is unsupported.
export async function getReportTargetOwnerId(
  client: ReadClient,
  targetType: string,
  targetId: string,
): Promise<string | null> {
  switch (targetType) {
    case 'photographer_profile': {
      const profile = await client.photographerProfile.findUnique({
        where: { id: targetId },
        select: { userId: true },
      });
      return profile?.userId ?? null;
    }
    case 'portfolio_image': {
      const image = await client.portfolioImage.findUnique({
        where: { id: targetId },
        select: { profile: { select: { userId: true } } },
      });
      return image?.profile.userId ?? null;
    }
    case 'request': {
      const request = await client.request.findUnique({
        where: { id: targetId },
        select: { clientId: true },
      });
      return request?.clientId ?? null;
    }
    case 'job_offer': {
      const offer = await client.jobOffer.findUnique({
        where: { id: targetId },
        select: { professional: { select: { userId: true } } },
      });
      return offer?.professional.userId ?? null;
    }
    case 'job_application': {
      const application = await client.jobApplication.findUnique({
        where: { id: targetId },
        select: { photographer: { select: { userId: true } } },
      });
      return application?.photographer.userId ?? null;
    }
    default:
      return null;
  }
}
