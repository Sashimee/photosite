import { DEVICE_PLATFORMS, NOTIFICATION_CHANNELS, NOTIFICATION_TYPES } from '../enums.js';
import {
  CursorPaginationQuerySchema,
  IdSchema,
  IsoDateTimeSchema,
  MoneySchema,
  errorResponses,
  paginatedResponseSchema,
} from './common.js';
import { AUTH_SECURITY, apiPath, registry } from './registry.js';
import { z } from './zod.js';

export const NotificationTypeSchema = z
  .enum(NOTIFICATION_TYPES)
  .openapi({ example: 'quote_received' });

export const NotificationChannelSchema = z
  .enum(NOTIFICATION_CHANNELS)
  .openapi({ example: 'email' });

export const NotificationPayloadSchema = z
  .object({
    quoteId: IdSchema.optional(),
    requestId: IdSchema.optional(),
    requestTitle: z.string().min(1).max(150).optional(),
    total: MoneySchema.optional(),
    counterpartName: z.string().min(1).max(150).optional(),
  })
  .strict()
  .openapi('NotificationPayload');

export type NotificationPayload = z.infer<typeof NotificationPayloadSchema>;

export const NotificationSchema = z
  .object({
    id: IdSchema,
    type: NotificationTypeSchema,
    payload: NotificationPayloadSchema,
    channels: z.array(NotificationChannelSchema).min(1),
    readAt: IsoDateTimeSchema.nullable(),
    createdAt: IsoDateTimeSchema,
  })
  .strict()
  .openapi('Notification');

export const NotificationsQuerySchema = CursorPaginationQuerySchema.extend({
  unread: z.stringbool().optional(),
}).strict();

export const UnreadCountResponseSchema = z
  .object({ count: z.int().nonnegative() })
  .strict()
  .openapi('UnreadCount');

export const MarkAllNotificationsReadResponseSchema = z
  .object({ count: z.int().nonnegative() })
  .strict()
  .openapi('MarkAllNotificationsReadResult');

const NOTIFICATION_PREFERENCE_MATRIX_SIZE =
  NOTIFICATION_TYPES.length * NOTIFICATION_CHANNELS.length;

export const NotificationPreferenceEntrySchema = z
  .object({
    type: NotificationTypeSchema,
    channel: NotificationChannelSchema,
    enabled: z.boolean(),
  })
  .strict()
  .openapi('NotificationPreferenceEntry');

export const NotificationPreferencesResponseSchema = z
  .object({
    preferences: z
      .array(NotificationPreferenceEntrySchema)
      .length(NOTIFICATION_PREFERENCE_MATRIX_SIZE),
  })
  .strict()
  .openapi('NotificationPreferences');

function isCompletePreferenceMatrix(entries: { type: string; channel: string }[]): boolean {
  const keys = new Set(entries.map((entry) => `${entry.type}:${entry.channel}`));
  if (keys.size !== entries.length) return false;

  return NOTIFICATION_TYPES.every((type) =>
    NOTIFICATION_CHANNELS.every((channel) => keys.has(`${type}:${channel}`)),
  );
}

export const UpdateNotificationPreferencesRequestSchema = z
  .object({
    preferences: z
      .array(NotificationPreferenceEntrySchema)
      .length(NOTIFICATION_PREFERENCE_MATRIX_SIZE),
  })
  .strict()
  .refine((data) => isCompletePreferenceMatrix(data.preferences), {
    message: 'preferences must cover every notification type and channel exactly once',
    path: ['preferences'],
  })
  .refine(
    (data) => data.preferences.every((entry) => entry.channel !== 'in_app' || entry.enabled),
    { message: 'in_app notifications cannot be disabled', path: ['preferences'] },
  );

export const ExpoPushTokenSchema = z
  .string()
  .regex(/^Expo(nent)?PushToken\[[^\]]+\]$/, 'must be a valid Expo push token')
  .openapi({
    description: 'Expo push token',
    example: 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]',
  });

export const DevicePlatformSchema = z.enum(DEVICE_PLATFORMS).openapi({ example: 'ios' });

export const DeviceSchema = z
  .object({
    id: IdSchema,
    platform: DevicePlatformSchema,
    lastSeenAt: IsoDateTimeSchema,
  })
  .strict()
  .openapi('Device');

export const RegisterDeviceRequestSchema = z
  .object({
    expoPushToken: ExpoPushTokenSchema,
    platform: DevicePlatformSchema,
  })
  .strict();

registry.registerPath({
  method: 'get',
  path: apiPath('/notifications'),
  summary: "List the current user's notifications",
  tags: ['notifications'],
  security: AUTH_SECURITY,
  request: {
    query: NotificationsQuerySchema,
  },
  responses: {
    '200': {
      description: 'A page of notifications',
      content: { 'application/json': { schema: paginatedResponseSchema(NotificationSchema) } },
    },
    ...errorResponses([400, 401]),
  },
});

registry.registerPath({
  method: 'get',
  path: apiPath('/notifications/unread-count'),
  summary: "Get the current user's unread notification count",
  tags: ['notifications'],
  security: AUTH_SECURITY,
  responses: {
    '200': {
      description: 'The unread notification count',
      content: { 'application/json': { schema: UnreadCountResponseSchema } },
    },
    ...errorResponses([401]),
  },
});

registry.registerPath({
  method: 'post',
  path: apiPath('/notifications/{id}/read'),
  summary: 'Mark a notification as read',
  tags: ['notifications'],
  security: AUTH_SECURITY,
  request: {
    params: z.object({ id: IdSchema }).strict(),
  },
  responses: {
    '200': {
      description: 'Notification marked as read',
      content: { 'application/json': { schema: NotificationSchema } },
    },
    ...errorResponses([401, 404]),
  },
});

registry.registerPath({
  method: 'post',
  path: apiPath('/notifications/read-all'),
  summary: "Mark all of the current user's notifications as read",
  tags: ['notifications'],
  security: AUTH_SECURITY,
  responses: {
    '200': {
      description: 'Notifications marked as read',
      content: { 'application/json': { schema: MarkAllNotificationsReadResponseSchema } },
    },
    ...errorResponses([401]),
  },
});

registry.registerPath({
  method: 'get',
  path: apiPath('/me/notification-preferences'),
  summary: "Get the current user's notification preferences",
  tags: ['notifications'],
  security: AUTH_SECURITY,
  responses: {
    '200': {
      description: 'The notification preference matrix, filled in with defaults',
      content: { 'application/json': { schema: NotificationPreferencesResponseSchema } },
    },
    ...errorResponses([401]),
  },
});

registry.registerPath({
  method: 'put',
  path: apiPath('/me/notification-preferences'),
  summary: "Replace the current user's notification preferences",
  tags: ['notifications'],
  security: AUTH_SECURITY,
  request: {
    body: {
      content: { 'application/json': { schema: UpdateNotificationPreferencesRequestSchema } },
    },
  },
  responses: {
    '200': {
      description: 'The updated notification preference matrix',
      content: { 'application/json': { schema: NotificationPreferencesResponseSchema } },
    },
    ...errorResponses([400, 401, 422]),
  },
});

registry.registerPath({
  method: 'post',
  path: apiPath('/me/devices'),
  summary: 'Register or reassign a push device',
  tags: ['notifications'],
  security: AUTH_SECURITY,
  request: {
    body: { content: { 'application/json': { schema: RegisterDeviceRequestSchema } } },
  },
  responses: {
    '201': {
      description: 'Device registered',
      content: { 'application/json': { schema: DeviceSchema } },
    },
    ...errorResponses([400, 401, 422, 429]),
  },
});

registry.registerPath({
  method: 'delete',
  path: apiPath('/me/devices/{id}'),
  summary: "Remove one of the current user's push devices",
  tags: ['notifications'],
  security: AUTH_SECURITY,
  request: {
    params: z.object({ id: IdSchema }).strict(),
  },
  responses: {
    '204': { description: 'Device removed' },
    ...errorResponses([401, 403, 404]),
  },
});
