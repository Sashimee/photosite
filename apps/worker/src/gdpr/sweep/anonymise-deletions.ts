import type { PrismaClient } from '@photoo/db';
import { GDPR_DELETION_GRACE_PERIOD_MS, PUBLIC_UPLOAD_PURPOSES } from '@photoo/shared';
import type { Logger } from 'nestjs-pino';
import type { RecordAuditLogInput } from '../../common/audit-log.service.js';
import { reportSweepFailure } from '../../common/monitoring/report-sweep-failure.js';

export interface AnonymiseStorage {
  config: { privateBucket: string; publicBucket: string };
  deleteObject(bucket: string, key: string): Promise<void>;
}

export interface AnonymiseDeletionsDeps {
  prisma: { client: PrismaClient };
  storage: AnonymiseStorage;
  auditLog: { record(input: RecordAuditLogInput): Promise<void> };
  logger: Logger;
}

export interface AnonymiseDeletionsResult {
  usersAnonymised: number;
  usersFailed: number;
  usersSkipped: number;
}

// `en` is the source-of-truth locale (CLAUDE.md), not a nullable field.
const ANONYMISED_LOCALE = 'en';
const ANONYMISED_DISPLAY_NAME = 'Deleted user';
const ANONYMISED_COMPANY_NAME = 'Deleted company';
export const ANONYMISATION_FAILURE_REASON = 'anonymisation_failed';

interface AnonymisationCounts {
  sessions: number;
  devices: number;
  accounts: number;
  twoFactors: number;
  notifications: number;
  notificationPreferences: number;
  products: number;
  portfolioImages: number;
  uploads: number;
  jobApplicationsAnonymised: number;
  professionalProfileAnonymised: number;
}

async function anonymiseOne(
  deps: AnonymiseDeletionsDeps,
  dataRequestId: string,
  userId: string,
  cutoff: Date,
): Promise<'anonymised' | 'skipped'> {
  const objectsToDelete: { bucket: string; key: string }[] = [];

  const counts = await deps.prisma.client.$transaction(async (tx) => {
    // Claimed first so a cancel racing the sweep's findMany loses the row.
    const claim = await tx.dataRequest.updateMany({
      where: { id: dataRequestId, status: 'pending', requestedAt: { lte: cutoff } },
      data: { status: 'completed', completedAt: new Date(), failureReason: null },
    });
    if (claim.count === 0) {
      return 'skipped' as const;
    }

    const profile = await tx.photographerProfile.findUnique({
      where: { userId },
      select: { id: true, avatarUploadId: true, coverUploadId: true },
    });

    let productsCount = 0;
    let portfolioImagesCount = 0;
    if (profile) {
      const portfolioImages = await tx.portfolioImage.findMany({
        where: { profileId: profile.id },
        select: { id: true },
      });
      portfolioImagesCount = portfolioImages.length;
      await tx.portfolioImage.deleteMany({ where: { profileId: profile.id } });

      const products = await tx.product.deleteMany({ where: { profileId: profile.id } });
      productsCount = products.count;

      await tx.photographerProfile.update({
        where: { id: profile.id },
        data: {
          slug: `deleted-${profile.id}`,
          displayName: ANONYMISED_DISPLAY_NAME,
          headline: null,
          bio: {},
          links: [],
          languages: [],
        },
      });
    }

    const jobApplications = profile
      ? await tx.jobApplication.updateMany({
          where: { photographerId: profile.id },
          data: { message: '', portfolioLink: null },
        })
      : { count: 0 };

    const professionalProfile = await tx.professionalProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (professionalProfile) {
      await tx.professionalProfile.update({
        where: { id: professionalProfile.id },
        data: { companyName: ANONYMISED_COMPANY_NAME, website: null, vatNumber: null },
      });
    }

    const sessions = await tx.session.deleteMany({ where: { userId } });
    const devices = await tx.device.deleteMany({ where: { userId } });
    const accounts = await tx.account.deleteMany({ where: { userId } });
    const twoFactors = await tx.twoFactor.deleteMany({ where: { userId } });
    const notifications = await tx.notification.deleteMany({ where: { userId } });
    const notificationPreferences = await tx.notificationPreference.deleteMany({
      where: { userId },
    });

    const orphanableUploads = await tx.upload.findMany({
      where: {
        ownerId: userId,
        messageAttachment: null,
        verificationDocument: null,
        deliveryFile: null,
      },
      select: { id: true, objectKey: true, purpose: true, variants: true },
    });
    for (const upload of orphanableUploads) {
      objectsToDelete.push({ bucket: deps.storage.config.privateBucket, key: upload.objectKey });
      if ((PUBLIC_UPLOAD_PURPOSES as readonly string[]).includes(upload.purpose)) {
        const variants = upload.variants as Record<string, string> | null;
        for (const key of Object.values(variants ?? {})) {
          objectsToDelete.push({ bucket: deps.storage.config.publicBucket, key });
        }
      }
    }
    await tx.upload.deleteMany({
      where: { id: { in: orphanableUploads.map((upload) => upload.id) } },
    });

    await tx.user.update({
      where: { id: userId },
      data: {
        email: `deleted-${userId}@deleted.invalid`,
        name: null,
        locale: ANONYMISED_LOCALE,
      },
    });

    const result: AnonymisationCounts = {
      sessions: sessions.count,
      devices: devices.count,
      accounts: accounts.count,
      twoFactors: twoFactors.count,
      notifications: notifications.count,
      notificationPreferences: notificationPreferences.count,
      products: productsCount,
      portfolioImages: portfolioImagesCount,
      uploads: orphanableUploads.length,
      jobApplicationsAnonymised: jobApplications.count,
      professionalProfileAnonymised: professionalProfile ? 1 : 0,
    };
    return result;
  });

  if (counts === 'skipped') {
    return 'skipped';
  }

  for (const object of objectsToDelete) {
    try {
      await deps.storage.deleteObject(object.bucket, object.key);
    } catch (error) {
      deps.logger.warn(
        { err: error, dataRequestId },
        'gdpr-sweep: failed to delete an anonymised upload object, leaving the DB row gone',
      );
    }
  }

  await deps.auditLog.record({
    actorType: 'system',
    actorId: null,
    action: 'gdpr_sweep.anonymised',
    targetType: 'User',
    targetId: userId,
    after: counts,
  });

  return 'anonymised';
}

export async function anonymiseDeletions(
  deps: AnonymiseDeletionsDeps,
): Promise<AnonymiseDeletionsResult> {
  const cutoff = new Date(Date.now() - GDPR_DELETION_GRACE_PERIOD_MS);
  const due = await deps.prisma.client.dataRequest.findMany({
    where: { type: 'delete', status: 'pending', requestedAt: { lte: cutoff } },
    select: { id: true, userId: true },
  });

  let usersAnonymised = 0;
  let usersFailed = 0;
  let usersSkipped = 0;
  for (const request of due) {
    try {
      const outcome = await anonymiseOne(deps, request.id, request.userId, cutoff);
      if (outcome === 'skipped') {
        usersSkipped += 1;
      } else {
        usersAnonymised += 1;
      }
    } catch (error) {
      usersFailed += 1;
      deps.logger.error(
        { err: error, dataRequestId: request.id },
        'gdpr-sweep: failed to anonymise a deletion request',
      );
      reportSweepFailure('anonymise-deletions', error, { dataRequestId: request.id });

      try {
        await deps.prisma.client.dataRequest.updateMany({
          where: { id: request.id, status: 'pending' },
          data: { failureReason: ANONYMISATION_FAILURE_REASON },
        });
      } catch (updateError) {
        deps.logger.error(
          { err: updateError, dataRequestId: request.id },
          'gdpr-sweep: failed to record the failureReason on a deletion request',
        );
      }
    }
  }

  deps.logger.log(
    { usersAnonymised, usersFailed, usersSkipped },
    'gdpr-sweep: anonymise-deletions phase complete',
  );
  return { usersAnonymised, usersFailed, usersSkipped };
}
