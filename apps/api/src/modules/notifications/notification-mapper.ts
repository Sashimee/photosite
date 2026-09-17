import type { Device, Notification } from '@photoo/db';
import { DeviceSchema, NotificationSchema } from '@photoo/shared';
import type { z } from 'zod';

export function mapNotification(notification: Notification): z.infer<typeof NotificationSchema> {
  return NotificationSchema.parse({
    id: notification.id,
    type: notification.type,
    payload: notification.payload,
    channels: notification.channels,
    readAt: notification.readAt ? notification.readAt.toISOString() : null,
    createdAt: notification.createdAt.toISOString(),
  });
}

export function mapDevice(device: Device): z.infer<typeof DeviceSchema> {
  return DeviceSchema.parse({
    id: device.id,
    platform: device.platform,
    lastSeenAt: device.lastSeenAt.toISOString(),
  });
}
