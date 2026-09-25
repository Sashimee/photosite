import type { PrismaClient } from '@photoo/db';
import { EmailJobSchema, GdprExportJobSchema, type GdprExportJob } from '@photoo/shared';
import type { Job, Processor } from 'bullmq';
import type { Logger } from 'nestjs-pino';
import type { RecordAuditLogInput } from '../common/audit-log.service.js';
import type { JobQueueLike } from '../queues/processors/types.js';
import type { ArchiveStorage } from './export/archive.js';
import { writeZipArchive } from './export/archive.js';
import { collectExportData } from './export/collect.js';
import { buildManifest } from './export/manifest.js';
import { readPolicyVersion } from './export/policy-version.js';
import { buildReadmeText } from './export/readme.js';
import { findNotifiableUserEmail, notifyExportFailed } from './notify-export-failed.js';

export interface GdprExportDeps {
  prisma: { client: PrismaClient };
  storage: ArchiveStorage & { config: { privateBucket: string } };
  auditLog: { record(input: RecordAuditLogInput): Promise<void> };
  logger: Logger;
  emailQueue: JobQueueLike;
  webAppUrl: string;
}

const EXPORT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const EXPORT_FAILURE_REASON = 'export_failed';
const EMAIL_JOB_FAILED_RETENTION_SECONDS = 24 * 60 * 60;

function isFinalAttempt(job: Job): boolean {
  const attempts = job.opts.attempts ?? 1;
  return job.attemptsMade >= attempts;
}

function exportKeyFor(dataRequestId: string): string {
  return `gdpr-exports/${dataRequestId}.zip`;
}

async function notifyExportReady(
  deps: GdprExportDeps,
  dataRequestId: string,
  userId: string,
  expiresAt: Date,
): Promise<void> {
  const email = await findNotifiableUserEmail(deps, userId);
  if (!email) {
    return;
  }

  const job = EmailJobSchema.parse({
    type: 'data-export-ready' as const,
    to: email,
    url: `${deps.webAppUrl}/account`,
    expiresAt: expiresAt.toISOString(),
  });
  await deps.emailQueue.add(job.type, job, {
    jobId: `${job.type}-${dataRequestId}`,
    removeOnComplete: true,
    removeOnFail: { age: EMAIL_JOB_FAILED_RETENTION_SECONDS },
  });
}

export function createGdprExportProcessor(deps: GdprExportDeps): Processor<GdprExportJob> {
  return async (job: Job<GdprExportJob>) => {
    const payload = GdprExportJobSchema.parse(job.data);
    const dataRequest = await deps.prisma.client.dataRequest.findUnique({
      where: { id: payload.dataRequestId },
    });
    if (!dataRequest) {
      deps.logger.warn(
        { dataRequestId: payload.dataRequestId },
        'gdpr-export: data request not found, skipping',
      );
      return;
    }
    if (dataRequest.type !== 'export') {
      deps.logger.warn(
        { dataRequestId: dataRequest.id, type: dataRequest.type },
        'gdpr-export: refusing to build an archive for a non-export request',
      );
      return;
    }
    if (dataRequest.status === 'cancelled') {
      return;
    }
    if (dataRequest.status === 'ready') {
      if (dataRequest.expiresAt) {
        await notifyExportReady(deps, dataRequest.id, dataRequest.userId, dataRequest.expiresAt);
      }
      return;
    }

    await deps.prisma.client.dataRequest.update({
      where: { id: dataRequest.id },
      data: { status: 'processing' },
    });

    let readyExpiresAt: Date;

    try {
      const data = await collectExportData(deps.prisma.client, dataRequest.userId);
      const policyVersion = await readPolicyVersion(deps.prisma.client);
      const manifest = buildManifest(data, policyVersion);
      const key = exportKeyFor(dataRequest.id);

      await writeZipArchive({
        storage: deps.storage,
        bucket: deps.storage.config.privateBucket,
        key,
        jsonFiles: {
          'manifest.json': manifest,
          'user.json': data.user,
          'accounts.json': data.accounts,
          'sessions.json': data.sessions,
          'devices.json': data.devices,
          'consents.json': data.consents,
          'notifications.json': data.notifications,
          'requests.json': data.requests,
          'quotes.json': data.quotes,
          'photographer-profile.json': data.photographerProfile,
          'professional-profile.json': data.professionalProfile,
          'job-offers.json': data.jobOffers,
          'job-applications.json': data.jobApplications,
          'products.json': data.products,
          'portfolio-images.json': data.portfolioImages,
          'uploads.json': data.uploads,
          'verification-cases.json': data.verificationCases,
          'messages.json': data.messages,
        },
        textFiles: { 'README.txt': buildReadmeText() },
        binaryFiles: data.files,
      });

      const completedAt = new Date();
      const expiresAt = new Date(completedAt.getTime() + EXPORT_RETENTION_MS);
      await deps.prisma.client.dataRequest.update({
        where: { id: dataRequest.id },
        data: { status: 'ready', completedAt, exportKey: key, expiresAt },
      });
      await deps.auditLog.record({
        actorType: 'system',
        actorId: null,
        action: 'data_request.export_completed',
        targetType: 'DataRequest',
        targetId: dataRequest.id,
        after: { status: 'ready', rowCounts: manifest.files },
      });
      readyExpiresAt = expiresAt;
    } catch (error) {
      if (isFinalAttempt(job)) {
        const failedUpdate = await deps.prisma.client.dataRequest.updateMany({
          where: { id: dataRequest.id, status: 'processing' },
          data: { status: 'failed', failureReason: EXPORT_FAILURE_REASON },
        });
        if (failedUpdate.count === 1) {
          await deps.auditLog.record({
            actorType: 'system',
            actorId: null,
            action: 'data_request.export_failed',
            targetType: 'DataRequest',
            targetId: dataRequest.id,
            after: { status: 'failed', failureReason: EXPORT_FAILURE_REASON },
          });
          await notifyExportFailed(deps, dataRequest.id, dataRequest.userId);
        }
      }
      throw error;
    }

    await notifyExportReady(deps, dataRequest.id, dataRequest.userId, readyExpiresAt);
  };
}
