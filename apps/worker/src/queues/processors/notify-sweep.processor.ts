import { notifyJobOptions } from '@photoo/shared';
import type { Processor } from 'bullmq';
import type { Logger } from 'nestjs-pino';
import type { JobQueueLike } from './types.js';

export interface PendingNotificationWhere {
  createdAt: { lt: Date; gt: Date };
  OR: [
    { channels: { has: 'email' }; emailSentAt: null },
    { channels: { has: 'push' }; pushSentAt: null },
  ];
}

export interface NotifySweepDeps {
  prisma: {
    client: {
      notification: {
        findMany(args: {
          where: PendingNotificationWhere;
          take: number;
        }): Promise<{ id: string }[]>;
      };
    };
  };
  notifyQueue: JobQueueLike;
  logger: Logger;
}

// Covers an enqueue lost after the Notification row was inserted, or a
// notify job that failed all its attempts. Rows younger than 5 minutes are
// left alone (the first enqueue may still be in flight); rows older than
// 48 hours are left alone too (something else is wrong, not worth retrying
// forever). The channel/sentAt filter runs in SQL, not in JS, so an
// in-app-only notification (no email/push ever wanted) never matches.
const STALE_THRESHOLD_MS = 5 * 60 * 1000;
const MAX_AGE_MS = 48 * 60 * 60 * 1000;
const BATCH_SIZE = 200;

export function createNotifySweepProcessor(deps: NotifySweepDeps): Processor {
  return async () => {
    const now = Date.now();
    const pending = await deps.prisma.client.notification.findMany({
      where: {
        createdAt: { lt: new Date(now - STALE_THRESHOLD_MS), gt: new Date(now - MAX_AGE_MS) },
        OR: [
          { channels: { has: 'email' }, emailSentAt: null },
          { channels: { has: 'push' }, pushSentAt: null },
        ],
      },
      take: BATCH_SIZE,
    });

    let reenqueued = 0;
    for (const notification of pending) {
      try {
        // A distinct id per sweep attempt, not the notificationId: a
        // terminal (failed/completed) job under the same id would block a
        // re-add, and the notify processor's sentAt guards make
        // re-processing under a different id safe.
        await deps.notifyQueue.add(
          'notify',
          { notificationId: notification.id },
          notifyJobOptions(`${notification.id}:sweep:${String(now)}`),
        );
        reenqueued += 1;
      } catch (error) {
        deps.logger.error(
          { err: error, notificationId: notification.id },
          'notify-sweep: failed to re-enqueue a pending notification',
        );
      }
    }

    deps.logger.log({ reenqueued }, 'notify-sweep: re-enqueued stale pending notifications');
  };
}
