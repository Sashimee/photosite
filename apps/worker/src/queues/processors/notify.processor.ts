import {
  NotifyJobSchema,
  type NotificationPayload,
  type NotificationType,
  type NotifyJob,
} from '@photoo/shared';
import type { Processor } from 'bullmq';
import type { Logger } from 'nestjs-pino';
import type { MailTransport } from '../../email/mail-transport.js';
import { renderNotifyEmail } from '../../email/templates/notify-email.js';
import { renderNotifyPush } from '../../email/templates/notify-push.js';
import type { PushSender } from '../../push/push-sender.js';
import type { PushTicketStore } from '../../push/push-ticket-store.js';

export interface NotificationRow {
  id: string;
  userId: string;
  type: string;
  payload: unknown;
  channels: string[];
  emailSentAt: Date | null;
  pushSentAt: Date | null;
}

export interface UserRow {
  id: string;
  email: string;
  locale: string;
  deletedAt: Date | null;
}

export interface DeviceRow {
  id: string;
  expoPushToken: string;
}

export interface NotifyRepository {
  notification: {
    findUnique(args: { where: { id: string } }): Promise<NotificationRow | null>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
  };
  user: { findUnique(args: { where: { id: string } }): Promise<UserRow | null> };
  device: {
    findMany(args: { where: { userId: string } }): Promise<DeviceRow[]>;
    delete(args: { where: { id: string } }): Promise<unknown>;
  };
}

export interface NotifyProcessorDeps {
  prisma: { client: NotifyRepository };
  mailTransport: MailTransport;
  pushSender: PushSender;
  pushTicketStore: PushTicketStore;
  webAppUrl: string;
  logger: Logger;
}

// Delivery is per-channel and guarded by emailSentAt/pushSentAt: a job retry
// (or the notify-sweep re-enqueue) skips whatever a previous attempt already
// sent (docs/steps/1A.7-notifications.md "Creation and idempotency").
export function createNotifyProcessor(deps: NotifyProcessorDeps): Processor<NotifyJob> {
  return async (job) => {
    const { notificationId } = NotifyJobSchema.parse(job.data);
    const notification = await deps.prisma.client.notification.findUnique({
      where: { id: notificationId },
    });
    if (!notification) {
      deps.logger.warn({ notificationId }, 'notify: notification not found, skipping');
      return;
    }

    const user = await deps.prisma.client.user.findUnique({ where: { id: notification.userId } });
    if (!user || user.deletedAt) {
      await deps.prisma.client.notification.update({
        where: { id: notificationId },
        data: { emailSentAt: new Date(), pushSentAt: new Date() },
      });
      return;
    }

    const type = notification.type as NotificationType;
    const payload = notification.payload as NotificationPayload;

    if (notification.channels.includes('email') && !notification.emailSentAt) {
      const message = renderNotifyEmail(type, payload, user.locale, user.email, deps.webAppUrl);
      await deps.mailTransport.sendMail(message);
      await deps.prisma.client.notification.update({
        where: { id: notificationId },
        data: { emailSentAt: new Date() },
      });
    }

    if (notification.channels.includes('push') && !notification.pushSentAt) {
      const devices = await deps.prisma.client.device.findMany({ where: { userId: user.id } });
      if (devices.length > 0) {
        const rendered = renderNotifyPush(type, payload, user.locale, deps.webAppUrl);
        const results = await deps.pushSender.send(
          devices.map((device) => ({
            to: device.expoPushToken,
            title: rendered.title,
            body: rendered.body,
            url: rendered.url,
          })),
        );
        for (const result of results) {
          const device = devices.find((candidate) => candidate.expoPushToken === result.to);
          if (!device) {
            continue;
          }
          if (result.deviceNotRegistered) {
            await deps.prisma.client.device.delete({ where: { id: device.id } });
          } else if (result.ticketId) {
            await deps.pushTicketStore.store(result.ticketId, device.id);
          }
        }
      }
      await deps.prisma.client.notification.update({
        where: { id: notificationId },
        data: { pushSentAt: new Date() },
      });
    }
  };
}
