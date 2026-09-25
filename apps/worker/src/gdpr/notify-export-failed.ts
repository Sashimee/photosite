import type { PrismaClient } from '@photoo/db';
import { EmailJobSchema } from '@photoo/shared';
import type { JobQueueLike } from '../queues/processors/types.js';

export interface NotifyExportFailedDeps {
  prisma: { client: PrismaClient };
  emailQueue: JobQueueLike;
  webAppUrl: string;
}

const EMAIL_JOB_FAILED_RETENTION_SECONDS = 24 * 60 * 60;

export async function findNotifiableUserEmail(
  deps: { prisma: { client: PrismaClient } },
  userId: string,
): Promise<string | null> {
  const user = await deps.prisma.client.user.findUnique({
    where: { id: userId },
    select: { email: true, deletedAt: true },
  });
  return !user || user.deletedAt ? null : user.email;
}

export async function notifyExportFailed(
  deps: NotifyExportFailedDeps,
  dataRequestId: string,
  userId: string,
): Promise<void> {
  const email = await findNotifiableUserEmail(deps, userId);
  if (!email) {
    return;
  }

  const job = EmailJobSchema.parse({
    type: 'data-export-failed' as const,
    to: email,
    url: `${deps.webAppUrl}/account`,
  });
  await deps.emailQueue.add(job.type, job, {
    jobId: `${job.type}-${dataRequestId}`,
    removeOnComplete: true,
    removeOnFail: { age: EMAIL_JOB_FAILED_RETENTION_SECONDS },
  });
}
