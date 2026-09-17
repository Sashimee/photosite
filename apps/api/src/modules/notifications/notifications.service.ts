import { HttpException, Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@photoo/db';
import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_TYPES,
  NotificationPayloadSchema,
  isChannelAvailable,
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
import { Logger } from 'nestjs-pino';
import type { z } from 'zod';
import {
  decodeCreatedAtCursor,
  encodeCreatedAtCursor,
} from '../../common/pagination/created-at-cursor.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { mapDevice, mapNotification } from './notification-mapper.js';
import { NotifyQueueService } from './notify-queue.service.js';

const MAX_DEVICES_PER_USER = 10;

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
    @Inject(Logger) private readonly logger: Logger,
  ) {}

  // Inserts the Notification row, then enqueues with jobId = notificationId
  // (docs/steps/1A.7-notifications.md "Creation and idempotency"). Called by
  // every producer (quote-events, and later chat/booking/verification). An
  // enqueue failure is logged and swallowed, not surfaced to the caller:
  // notify-sweep re-enqueues rows still pending after a few minutes, so a
  // Redis blip here must not fail the business mutation that triggered it.
  // A row-insert failure still throws.
  async notify(
    userId: string,
    type: NotificationType,
    payload: NotificationPayload,
  ): Promise<void> {
    const validated = NotificationPayloadSchema.parse(payload);
    const preferences = await this.prisma.client.notificationPreference.findMany({
      where: { userId, type },
    });
    const channels = resolveNotificationChannels(type, preferences);

    const notification = await this.prisma.client.notification.create({
      data: { userId, type, payload: validated, channels },
    });

    try {
      await this.notifyQueue.enqueue(notification.id);
    } catch (error) {
      this.logger.error(
        { err: error, notificationId: notification.id },
        'notifications: failed to enqueue the notify job, relying on notify-sweep',
      );
    }
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
          enabled: preferenceEnabled(entry.type, entry.channel, entry.enabled),
        })),
      }),
    ]);
    return this.getPreferences(user);
  }

  async registerDevice(user: SessionUser, input: RegisterDeviceInput): Promise<DeviceDto> {
    const now = new Date();
    const existing = await this.prisma.client.device.findUnique({
      where: { expoPushToken: input.expoPushToken },
    });
    if (existing && existing.userId !== user.id) {
      this.logger.warn(
        { deviceId: existing.id, fromUserId: existing.userId, toUserId: user.id },
        'notifications: push device token changed owner',
      );
    }

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
    await this.enforceDeviceCap(user.id);
    return mapDevice(device);
  }

  // S3: caps a user at MAX_DEVICES_PER_USER, dropping the least recently
  // active ones first.
  private async enforceDeviceCap(userId: string): Promise<void> {
    const devices = await this.prisma.client.device.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      select: { id: true },
    });
    if (devices.length <= MAX_DEVICES_PER_USER) {
      return;
    }
    const toRemove = devices.slice(MAX_DEVICES_PER_USER).map((device) => device.id);
    await this.prisma.client.device.deleteMany({ where: { id: { in: toRemove } } });
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

function preferenceEnabled(
  type: NotificationType,
  channel: NotificationChannel,
  requested: boolean,
): boolean {
  if (channel === 'in_app') return true;
  if (!isChannelAvailable(type, channel)) return false;
  return requested;
}

function fillPreferenceMatrix(rows: readonly PreferenceRow[]): PreferencesResponse['preferences'] {
  const overrides = new Map(rows.map((row) => [`${row.type}:${row.channel}`, row.enabled]));
  const entries: PreferencesResponse['preferences'] = [];
  for (const type of NOTIFICATION_TYPES) {
    for (const channel of NOTIFICATION_CHANNELS) {
      const stored = overrides.get(`${type}:${channel}`) ?? true;
      entries.push({ type, channel, enabled: preferenceEnabled(type, channel, stored) });
    }
  }
  return entries;
}
