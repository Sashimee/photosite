import { describe, expect, it } from 'vitest';
import { NOTIFICATION_CHANNELS, NOTIFICATION_TYPES } from '../enums.js';
import {
  DeviceSchema,
  ExpoPushTokenSchema,
  NotificationPreferenceEntrySchema,
  NotificationSchema,
  NotificationsQuerySchema,
  RegisterDeviceRequestSchema,
  UnreadCountResponseSchema,
  UpdateNotificationPreferencesRequestSchema,
} from './notifications.js';

const id = '3fa85f64-5717-4562-b3fc-2c963f66afa6';

function fullPreferenceMatrix(overrides?: { type: string; channel: string; enabled: boolean }[]) {
  const entries = NOTIFICATION_TYPES.flatMap((type) =>
    NOTIFICATION_CHANNELS.map((channel) => ({ type, channel, enabled: true })),
  );

  if (!overrides) return entries;

  return entries.map((entry) => {
    const override = overrides.find((o) => o.type === entry.type && o.channel === entry.channel);
    return override ?? entry;
  });
}

describe('NotificationSchema', () => {
  const validNotification = {
    id,
    type: 'quote_received',
    payload: {
      quoteId: id,
      requestTitle: 'Wedding in Vianden',
      total: { amountCents: 15000, currency: 'EUR' },
      counterpartName: 'Jane Doe',
    },
    channels: ['email', 'in_app'],
    readAt: null,
    createdAt: '2026-09-16T12:00:00.000Z',
  };

  it('accepts a well-formed notification', () => {
    expect(NotificationSchema.safeParse(validNotification).success).toBe(true);
  });

  it('rejects an unknown type', () => {
    expect(
      NotificationSchema.safeParse({ ...validNotification, type: 'booking_paid' }).success,
    ).toBe(false);
  });

  it('rejects an empty channels array', () => {
    expect(NotificationSchema.safeParse({ ...validNotification, channels: [] }).success).toBe(
      false,
    );
  });

  it('rejects an unknown payload field', () => {
    expect(
      NotificationSchema.safeParse({
        ...validNotification,
        payload: { ...validNotification.payload, message: 'private message body' },
      }).success,
    ).toBe(false);
  });
});

describe('NotificationsQuerySchema', () => {
  it('defaults limit and leaves unread unset', () => {
    const result = NotificationsQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(20);
      expect(result.data.unread).toBeUndefined();
    }
  });

  it('coerces an unread=true query string', () => {
    const result = NotificationsQuerySchema.safeParse({ unread: 'true' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.unread).toBe(true);
  });

  it('coerces an unread=false query string', () => {
    const result = NotificationsQuerySchema.safeParse({ unread: 'false' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.unread).toBe(false);
  });

  it('rejects a non-boolean unread value', () => {
    expect(NotificationsQuerySchema.safeParse({ unread: 'maybe' }).success).toBe(false);
  });
});

describe('UnreadCountResponseSchema', () => {
  it('accepts a non-negative count', () => {
    expect(UnreadCountResponseSchema.safeParse({ count: 0 }).success).toBe(true);
  });

  it('rejects a negative count', () => {
    expect(UnreadCountResponseSchema.safeParse({ count: -1 }).success).toBe(false);
  });
});

describe('NotificationPreferenceEntrySchema', () => {
  it('accepts a well-formed entry', () => {
    expect(
      NotificationPreferenceEntrySchema.safeParse({
        type: 'quote_received',
        channel: 'email',
        enabled: true,
      }).success,
    ).toBe(true);
  });

  it('rejects an unknown channel', () => {
    expect(
      NotificationPreferenceEntrySchema.safeParse({
        type: 'quote_received',
        channel: 'sms',
        enabled: true,
      }).success,
    ).toBe(false);
  });
});

describe('UpdateNotificationPreferencesRequestSchema', () => {
  it('accepts a complete matrix', () => {
    expect(
      UpdateNotificationPreferencesRequestSchema.safeParse({
        preferences: fullPreferenceMatrix(),
      }).success,
    ).toBe(true);
  });

  it('rejects a matrix missing an entry', () => {
    const preferences = fullPreferenceMatrix().slice(1);
    expect(UpdateNotificationPreferencesRequestSchema.safeParse({ preferences }).success).toBe(
      false,
    );
  });

  it('rejects a matrix with a duplicate entry', () => {
    const preferences = fullPreferenceMatrix();
    preferences[preferences.length - 1] = {
      type: NOTIFICATION_TYPES[0],
      channel: NOTIFICATION_CHANNELS[0],
      enabled: false,
    };
    expect(UpdateNotificationPreferencesRequestSchema.safeParse({ preferences }).success).toBe(
      false,
    );
  });

  it('rejects disabling in_app', () => {
    const preferences = fullPreferenceMatrix([
      { type: 'quote_received', channel: 'in_app', enabled: false },
    ]);
    expect(UpdateNotificationPreferencesRequestSchema.safeParse({ preferences }).success).toBe(
      false,
    );
  });

  it('accepts disabling email and push', () => {
    const preferences = fullPreferenceMatrix([
      { type: 'quote_received', channel: 'email', enabled: false },
      { type: 'quote_received', channel: 'push', enabled: false },
    ]);
    expect(UpdateNotificationPreferencesRequestSchema.safeParse({ preferences }).success).toBe(
      true,
    );
  });
});

describe('ExpoPushTokenSchema', () => {
  it('accepts an ExponentPushToken', () => {
    expect(ExpoPushTokenSchema.safeParse('ExponentPushToken[abc123DEF456]').success).toBe(true);
  });

  it('accepts an ExpoPushToken', () => {
    expect(ExpoPushTokenSchema.safeParse('ExpoPushToken[abc123DEF456]').success).toBe(true);
  });

  it('rejects a malformed token', () => {
    expect(ExpoPushTokenSchema.safeParse('abc123DEF456').success).toBe(false);
  });

  it('rejects an empty bracket body', () => {
    expect(ExpoPushTokenSchema.safeParse('ExponentPushToken[]').success).toBe(false);
  });
});

describe('RegisterDeviceRequestSchema', () => {
  const valid = { expoPushToken: 'ExponentPushToken[abc123DEF456]', platform: 'ios' };

  it('accepts a well-formed device registration', () => {
    expect(RegisterDeviceRequestSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects an unknown platform', () => {
    expect(RegisterDeviceRequestSchema.safeParse({ ...valid, platform: 'watchos' }).success).toBe(
      false,
    );
  });

  it('rejects a request carrying a userId', () => {
    expect(RegisterDeviceRequestSchema.safeParse({ ...valid, userId: id }).success).toBe(false);
  });
});

describe('DeviceSchema', () => {
  it('never exposes the push token', () => {
    expect(
      DeviceSchema.safeParse({
        id,
        platform: 'ios',
        lastSeenAt: '2026-09-16T12:00:00.000Z',
        expoPushToken: 'ExponentPushToken[abc123DEF456]',
      }).success,
    ).toBe(false);
  });
});
