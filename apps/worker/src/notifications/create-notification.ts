import {
  NotificationPayloadSchema,
  notifyJobOptions,
  resolveNotificationChannels,
  type NotificationPayload,
  type NotificationType,
} from '@photoo/shared';
import type { JobQueueLike } from '../queues/processors/types.js';

export interface NotifyInsertClient {
  notification: {
    create(args: { data: Record<string, unknown> }): Promise<{ id: string }>;
  };
  notificationPreference: {
    findMany(args: {
      where: Record<string, unknown>;
    }): Promise<{ type: string; channel: 'email' | 'push' | 'in_app'; enabled: boolean }[]>;
  };
}

export interface CreateNotificationDeps {
  prisma: { client: NotifyInsertClient };
  notifyQueue: JobQueueLike;
}

// Inserts the Notification row only; validated and (if too long) truncated
// against NotificationPayloadSchema so a runaway display name/title can
// never make it into storage. Callers that need the insert inside a larger
// transaction (quote-expiry) use this directly and enqueue separately once
// that transaction has committed.
export async function insertNotification(
  client: NotifyInsertClient,
  userId: string,
  type: NotificationType,
  payload: NotificationPayload,
): Promise<string> {
  const validated = NotificationPayloadSchema.parse(payload);
  const preferences = await client.notificationPreference.findMany({ where: { userId, type } });
  const channels = resolveNotificationChannels(type, preferences);

  const notification = await client.notification.create({
    data: { userId, type, payload: validated, channels },
  });
  return notification.id;
}

export async function enqueueNotification(
  notifyQueue: JobQueueLike,
  notificationId: string,
): Promise<void> {
  await notifyQueue.add('notify', { notificationId }, notifyJobOptions(notificationId));
}

// Shared by every worker call site that creates a notification without
// going through the API's NotificationsService (currently just the
// quote-expiry job's quote_expired notifications). Insert and enqueue are
// not atomic with each other by design (queue.add() cannot join a Postgres
// transaction); a lost enqueue here is covered by notify-sweep.
export async function createNotification(
  deps: CreateNotificationDeps,
  userId: string,
  type: NotificationType,
  payload: NotificationPayload,
): Promise<void> {
  const notificationId = await insertNotification(deps.prisma.client, userId, type, payload);
  await enqueueNotification(deps.notifyQueue, notificationId);
}
