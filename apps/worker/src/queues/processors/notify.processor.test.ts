import type { NotificationPayload, NotifyJob } from '@photoo/shared';
import type { Job } from 'bullmq';
import type { Logger } from 'nestjs-pino';
import { describe, expect, it, vi } from 'vitest';
import {
  createNotifyProcessor,
  type DeviceRow,
  type NotificationRow,
  type UserRow,
} from './notify.processor.js';

function fakeLogger(): Logger {
  return { log: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger;
}

const PAYLOAD: NotificationPayload = {
  quoteId: 'quote-1',
  requestTitle: 'Wedding at the castle',
  total: { amountCents: 150000, currency: 'EUR' },
  counterpartName: 'Jane Doe',
};

const NOTIFICATION_ID = '018f2e1a-0000-7000-8000-000000000001';

function baseNotification(overrides: Partial<NotificationRow> = {}): NotificationRow {
  return {
    id: NOTIFICATION_ID,
    userId: 'user-1',
    type: 'quote_received',
    payload: PAYLOAD,
    channels: ['email', 'push', 'in_app'],
    emailSentAt: null,
    pushSentAt: null,
    ...overrides,
  };
}

function baseUser(overrides: Partial<UserRow> = {}): UserRow {
  return { id: 'user-1', email: 'jane@example.com', locale: 'en', deletedAt: null, ...overrides };
}

function harness(options: {
  notification: NotificationRow | null;
  user: UserRow | null;
  devices?: DeviceRow[];
}) {
  const notificationUpdate = vi.fn<
    (args: {
      where: { id: string };
      data: Record<string, unknown>;
    }) => Promise<NotificationRow | null>
  >(() => Promise.resolve(options.notification));
  const deviceDelete = vi.fn(() => Promise.resolve());
  const sendMail = vi.fn(() => Promise.resolve());
  const send = vi.fn(() =>
    Promise.resolve<{ to: string; ticketId: string | null; deviceNotRegistered: boolean }[]>([]),
  );
  const store = vi.fn(() => Promise.resolve());

  const deps = {
    prisma: {
      client: {
        notification: {
          findUnique: vi.fn(() => Promise.resolve(options.notification)),
          update: notificationUpdate,
        },
        user: { findUnique: vi.fn(() => Promise.resolve(options.user)) },
        device: {
          findMany: vi.fn(() => Promise.resolve(options.devices ?? [])),
          delete: deviceDelete,
        },
      },
    },
    mailTransport: { sendMail },
    pushSender: { send, getReceipts: vi.fn(() => Promise.resolve({})) },
    pushTicketStore: {
      store,
      takeDue: vi.fn(() => Promise.resolve([])),
      clear: vi.fn(() => Promise.resolve()),
    },
    webAppUrl: 'https://photoo.lu',
    logger: fakeLogger(),
  };

  return { deps, notificationUpdate, deviceDelete, sendMail, send, store };
}

const FAKE_JOB = { data: { notificationId: NOTIFICATION_ID } } as Job<NotifyJob>;

describe('createNotifyProcessor', () => {
  it('sends email and marks emailSentAt when the channel wants it and has not sent yet', async () => {
    const { deps, notificationUpdate, sendMail } = harness({
      notification: baseNotification({ channels: ['email', 'in_app'] }),
      user: baseUser(),
    });

    await createNotifyProcessor(deps)(FAKE_JOB, undefined, undefined);

    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(notificationUpdate).toHaveBeenCalledWith({
      where: { id: NOTIFICATION_ID },
      data: { emailSentAt: expect.any(Date) as Date },
    });
  });

  it('skips email when emailSentAt is already set (retry does not double-send)', async () => {
    const { deps, sendMail, notificationUpdate } = harness({
      notification: baseNotification({ channels: ['email'], emailSentAt: new Date() }),
      user: baseUser(),
    });

    await createNotifyProcessor(deps)(FAKE_JOB, undefined, undefined);

    expect(sendMail).not.toHaveBeenCalled();
    expect(notificationUpdate).not.toHaveBeenCalled();
  });

  it('sends push to every device and stores a ticket for a successful send', async () => {
    const devices: DeviceRow[] = [{ id: 'device-1', expoPushToken: 'ExponentPushToken[abc]' }];
    const { deps, send, store, notificationUpdate } = harness({
      notification: baseNotification({ channels: ['push'] }),
      user: baseUser(),
      devices,
    });
    send.mockResolvedValueOnce([
      { to: 'ExponentPushToken[abc]', ticketId: 'ticket-1', deviceNotRegistered: false },
    ]);

    await createNotifyProcessor(deps)(FAKE_JOB, undefined, undefined);

    expect(store).toHaveBeenCalledWith('ticket-1', 'device-1');
    expect(notificationUpdate).toHaveBeenCalledWith({
      where: { id: NOTIFICATION_ID },
      data: { pushSentAt: expect.any(Date) as Date },
    });
  });

  it('deletes the device when Expo reports it as not registered', async () => {
    const devices: DeviceRow[] = [{ id: 'device-1', expoPushToken: 'ExponentPushToken[abc]' }];
    const { deps, send, deviceDelete } = harness({
      notification: baseNotification({ channels: ['push'] }),
      user: baseUser(),
      devices,
    });
    send.mockResolvedValueOnce([
      { to: 'ExponentPushToken[abc]', ticketId: null, deviceNotRegistered: true },
    ]);

    await createNotifyProcessor(deps)(FAKE_JOB, undefined, undefined);

    expect(deviceDelete).toHaveBeenCalledWith({ where: { id: 'device-1' } });
  });

  it('marks pushSentAt without calling Expo when the user has no devices', async () => {
    const { deps, send, notificationUpdate } = harness({
      notification: baseNotification({ channels: ['push'] }),
      user: baseUser(),
      devices: [],
    });

    await createNotifyProcessor(deps)(FAKE_JOB, undefined, undefined);

    expect(send).not.toHaveBeenCalled();
    expect(notificationUpdate).toHaveBeenCalledWith({
      where: { id: NOTIFICATION_ID },
      data: { pushSentAt: expect.any(Date) as Date },
    });
  });

  it('does nothing when the notification no longer exists', async () => {
    const { deps, sendMail } = harness({ notification: null, user: null });

    await createNotifyProcessor(deps)(FAKE_JOB, undefined, undefined);

    expect(sendMail).not.toHaveBeenCalled();
  });

  it('marks both channels sent without delivering when the user is gone', async () => {
    const { deps, sendMail, notificationUpdate } = harness({
      notification: baseNotification({ channels: ['email', 'push'] }),
      user: null,
    });

    await createNotifyProcessor(deps)(FAKE_JOB, undefined, undefined);

    expect(sendMail).not.toHaveBeenCalled();
    expect(notificationUpdate).toHaveBeenCalledWith({
      where: { id: NOTIFICATION_ID },
      data: { emailSentAt: expect.any(Date) as Date, pushSentAt: expect.any(Date) as Date },
    });
  });

  it('marks both channels sent without delivering when the user is deleted', async () => {
    const { deps, sendMail } = harness({
      notification: baseNotification({ channels: ['email', 'push'] }),
      user: baseUser({ deletedAt: new Date() }),
    });

    await createNotifyProcessor(deps)(FAKE_JOB, undefined, undefined);

    expect(sendMail).not.toHaveBeenCalled();
  });
});
