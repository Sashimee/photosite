import {
  resolveNotificationChannels,
  type NotificationPayload,
  type NotificationType,
} from '@photoo/shared';
import type { JobQueueLike } from '../queues/processors/types.js';

export interface CreateNotificationDeps {
  prisma: {
    client: {
      notification: {
        create(args: { data: Record<string, unknown> }): Promise<{ id: string }>;
      };
      notificationPreference: {
        findMany(args: {
          where: Record<string, unknown>;
        }): Promise<{ type: string; channel: 'email' | 'push' | 'in_app'; enabled: boolean }[]>;
      };
    };
  };
  notifyQueue: JobQueueLike;
}

const FAILED_JOB_RETENTION_SECONDS = 24 * 60 * 60;

// Shared by every worker call site that creates a notification without
// going through the API's NotificationsService (currently just the
// quote-expiry job's quote_expired notifications), so preference resolution
// and enqueue idempotency (jobId = notificationId) never drift from it.
export async function createNotification(
  deps: CreateNotificationDeps,
  userId: string,
  type: NotificationType,
  payload: NotificationPayload,
): Promise<void> {
  const preferences = await deps.prisma.client.notificationPreference.findMany({
    where: { userId, type },
  });
  const channels = resolveNotificationChannels(type, preferences);

  const notification = await deps.prisma.client.notification.create({
    data: { userId, type, payload, channels },
  });

  await deps.notifyQueue.add(
    'notify',
    { notificationId: notification.id },
    {
      jobId: notification.id,
      removeOnComplete: true,
      removeOnFail: { age: FAILED_JOB_RETENTION_SECONDS },
    },
  );
}
