import type { Processor } from 'bullmq';
import type { Logger } from 'nestjs-pino';
import type { JobQueueLike } from './types.js';

export interface PendingNotificationRow {
  id: string;
  channels: string[];
  emailSentAt: Date | null;
  pushSentAt: Date | null;
}

export interface NotifySweepDeps {
  prisma: {
    client: {
      notification: {
        findMany(args: { where: Record<string, unknown> }): Promise<PendingNotificationRow[]>;
      };
    };
  };
  notifyQueue: JobQueueLike;
  logger: Logger;
}

const FAILED_JOB_RETENTION_SECONDS = 24 * 60 * 60;

// Covers an enqueue lost after the Notification row was inserted
// (docs/steps/1A.7-notifications.md): rows older than 5 minutes that still
// want a channel they haven't sent on get re-enqueued with the same jobId,
// which BullMQ treats as a no-op if that job is still in flight.
const STALE_THRESHOLD_MS = 5 * 60 * 1000;

export function createNotifySweepProcessor(deps: NotifySweepDeps): Processor {
  return async () => {
    const staleBefore = new Date(Date.now() - STALE_THRESHOLD_MS);
    const pending = await deps.prisma.client.notification.findMany({
      where: {
        createdAt: { lt: staleBefore },
        OR: [{ emailSentAt: null }, { pushSentAt: null }],
      },
    });

    let reenqueued = 0;
    for (const notification of pending) {
      const needsEmail = notification.channels.includes('email') && !notification.emailSentAt;
      const needsPush = notification.channels.includes('push') && !notification.pushSentAt;
      if (!needsEmail && !needsPush) {
        continue;
      }
      await deps.notifyQueue.add(
        'notify',
        { notificationId: notification.id },
        {
          jobId: notification.id,
          removeOnComplete: true,
          removeOnFail: { age: FAILED_JOB_RETENTION_SECONDS },
        },
      );
      reenqueued += 1;
    }

    deps.logger.log({ reenqueued }, 'notify-sweep: re-enqueued stale pending notifications');
  };
}
