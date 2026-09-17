import { HttpException, Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@photoo/db';
import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_TYPES,
  resolveNotificationChannels,
  type DeviceSchema,
  type NotificationChannel,
  type NotificationPayload,
  type NotificationPreferencesResponseSchema,
  type NotificationSchema,
  type NotificationsQuerySchema,
  type NotificationType,
  type RegisterDeviceRequestSchema,
  type UnreadCountResponseSchema,
  type UpdateNotificationPreferencesRequestSchema,
} from '@photoo/shared';
import type { z } from 'zod';
import {
  decodeCreatedAtCursor,
  encodeCreatedAtCursor,
} from '../../common/pagination/created-at-cursor.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { mapDevice, mapNotification } from './notification-mapper.js';
import { NotifyQueueService } from './notify-queue.service.js';

interface SessionUser {
  id: string;
}

type ListQuery = z.infer<typeof NotificationsQuerySchema>;
type NotificationDto = z.infer<typeof NotificationSchema>;
type UnreadCount = z.infer<typeof UnreadCountResponseSchema>;
type PreferencesResponse = z.infer<typeof NotificationPreferencesResponseSchema>;
type UpdatePreferencesInput = z.infer<typeof UpdateNotificationPreferencesRequestSchema>;
type RegisterDeviceInput = z.infer<typeof RegisterDeviceRequestSchema>;
type DeviceDto = z.infer<typeof DeviceSchema>;

function notFound(message = 'Notification not found'): HttpException {
  return new HttpException({ code: 'NOT_FOUND', message }, 404);
}

@Injectable()
export class NotificationsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(NotifyQueueService) private readonly notifyQueue: NotifyQueueService,
  ) {}

  // Inserts the Notification row, then enqueues with jobId = notificationId
  // (docs/steps/1A.7-notifications.md "Creation and idempotency"). Called by
  // every producer (quote-events, and later chat/booking/verification).
  async notify(
    userId: string,
    type: NotificationType,
    payload: NotificationPayload,
  ): Promise<void> {
    const preferences = await this.prisma.client.notificationPreference.findMany({
      where: { userId, type },
    });
    const channels = resolveNotificationChannels(type, preferences);

    const notification = await this.prisma.client.notification.create({
      data: { userId, type, payload, channels },
    });

    await this.notifyQueue.enqueue(notification.id);
  }

  async list(
    user: SessionUser,
    query: ListQuery,
  ): Promise<{ items: NotificationDto[]; nextCursor: string | null }> {
    const cursor = query.cursor ? decodeCreatedAtCursor(query.cursor) : undefined;
    const rows = await this.prisma.client.notification.findMany({
      where: {
        userId: user.id,
        ...(query.unread ? { readAt: null } : {}),
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: cursor.createdAt } },
                { createdAt: cursor.createdAt, id: { gt: cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: query.limit + 1,
    });

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const last = page[page.length - 1];
    const nextCursor = hasMore && last ? encodeCreatedAtCursor(last.createdAt, last.id) : null;
    return { items: page.map(mapNotification), nextCursor };
  }

  async unreadCount(user: SessionUser): Promise<UnreadCount> {
    const count = await this.prisma.client.notification.count({
      where: { userId: user.id, readAt: null },
    });
    return { count };
  }

  async markRead(user: SessionUser, id: string): Promise<NotificationDto> {
    const notification = await this.prisma.client.notification.findUnique({ where: { id } });
    if (notification?.userId !== user.id) {
      throw notFound();
    }
    if (notification.readAt) {
      return mapNotification(notification);
    }
    const updated = await this.prisma.client.notification.update({
      where: { id },
      data: { readAt: new Date() },
    });
    return mapNotification(updated);
  }

  async markAllRead(user: SessionUser): Promise<{ count: number }> {
    const result = await this.prisma.client.notification.updateMany({
      where: { userId: user.id, readAt: null },
      data: { readAt: new Date() },
    });
    return { count: result.count };
  }

  async getPreferences(user: SessionUser): Promise<PreferencesResponse> {
    const rows = await this.prisma.client.notificationPreference.findMany({
      where: { userId: user.id },
    });
    return { preferences: fillPreferenceMatrix(rows) };
  }

  async updatePreferences(
    user: SessionUser,
    input: UpdatePreferencesInput,
  ): Promise<PreferencesResponse> {
    await this.prisma.client.$transaction([
      this.prisma.client.notificationPreference.deleteMany({ where: { userId: user.id } }),
      this.prisma.client.notificationPreference.createMany({
        data: input.preferences.map((entry) => ({
          userId: user.id,
          type: entry.type,
          channel: entry.channel,
          enabled: entry.channel === 'in_app' ? true : entry.enabled,
        })),
      }),
    ]);
    return this.getPreferences(user);
  }

  async registerDevice(user: SessionUser, input: RegisterDeviceInput): Promise<DeviceDto> {
    const now = new Date();
    const device = await this.prisma.client.device.upsert({
      where: { expoPushToken: input.expoPushToken },
      create: {
        userId: user.id,
        expoPushToken: input.expoPushToken,
        platform: input.platform,
        lastSeenAt: now,
      },
      update: { userId: user.id, platform: input.platform, lastSeenAt: now },
    });
    return mapDevice(device);
  }

  async deleteDevice(user: SessionUser, id: string): Promise<void> {
    const device = await this.prisma.client.device.findUnique({ where: { id } });
    if (device?.userId !== user.id) {
      throw new HttpException({ code: 'NOT_FOUND', message: 'Device not found' }, 404);
    }
    try {
      await this.prisma.client.device.delete({ where: { id } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        return;
      }
      throw error;
    }
  }
}

interface PreferenceRow {
  type: string;
  channel: NotificationChannel;
  enabled: boolean;
}

function fillPreferenceMatrix(rows: readonly PreferenceRow[]): PreferencesResponse['preferences'] {
  const overrides = new Map(rows.map((row) => [`${row.type}:${row.channel}`, row.enabled]));
  const entries: PreferencesResponse['preferences'] = [];
  for (const type of NOTIFICATION_TYPES) {
    for (const channel of NOTIFICATION_CHANNELS) {
      const enabled = channel === 'in_app' ? true : (overrides.get(`${type}:${channel}`) ?? true);
      entries.push({ type, channel, enabled });
    }
  }
  return entries;
}
