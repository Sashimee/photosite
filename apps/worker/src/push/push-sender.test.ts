import { describe, expect, it, vi } from 'vitest';

const chunkPushNotifications = vi.fn((messages: unknown[]) => [messages]);
const sendPushNotificationsAsync = vi.fn();
const chunkPushNotificationReceiptIds = vi.fn((ids: string[]) => [ids]);
const getPushNotificationReceiptsAsync = vi.fn();

class FakeExpo {
  accessToken: string | undefined;
  chunkPushNotifications = chunkPushNotifications;
  sendPushNotificationsAsync = sendPushNotificationsAsync;
  chunkPushNotificationReceiptIds = chunkPushNotificationReceiptIds;
  getPushNotificationReceiptsAsync = getPushNotificationReceiptsAsync;

  constructor(options?: { accessToken?: string }) {
    this.accessToken = options?.accessToken;
  }
}

vi.mock('expo-server-sdk', () => ({ Expo: FakeExpo }));

describe('createExpoPushSender', () => {
  it('maps a successful ticket to a send result with its ticket id', async () => {
    sendPushNotificationsAsync.mockResolvedValueOnce([{ status: 'ok', id: 'ticket-1' }]);
    const { createExpoPushSender } = await import('./push-sender.js');
    const sender = createExpoPushSender(undefined);

    const results = await sender.send([
      { to: 'ExponentPushToken[abc]', title: 'Hi', body: 'Hello', url: 'https://photoo.lu' },
    ]);

    expect(results).toEqual([
      { to: 'ExponentPushToken[abc]', ticketId: 'ticket-1', deviceNotRegistered: false },
    ]);
    expect(sendPushNotificationsAsync).toHaveBeenCalledWith([
      {
        to: 'ExponentPushToken[abc]',
        title: 'Hi',
        body: 'Hello',
        data: { url: 'https://photoo.lu' },
        sound: 'default',
      },
    ]);
  });

  it('flags a DeviceNotRegistered error ticket', async () => {
    sendPushNotificationsAsync.mockResolvedValueOnce([
      { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } },
    ]);
    const { createExpoPushSender } = await import('./push-sender.js');
    const sender = createExpoPushSender(undefined);

    const results = await sender.send([
      { to: 'ExponentPushToken[abc]', title: 'Hi', body: 'Hello', url: 'https://photoo.lu' },
    ]);

    expect(results).toEqual([
      {
        to: 'ExponentPushToken[abc]',
        ticketId: null,
        deviceNotRegistered: true,
        error: 'DeviceNotRegistered',
      },
    ]);
  });

  it('does not flag a non-DeviceNotRegistered error ticket, but surfaces the error code', async () => {
    sendPushNotificationsAsync.mockResolvedValueOnce([
      { status: 'error', message: 'oops', details: { error: 'MessageRateExceeded' } },
    ]);
    const { createExpoPushSender } = await import('./push-sender.js');
    const sender = createExpoPushSender(undefined);

    const results = await sender.send([
      { to: 'ExponentPushToken[abc]', title: 'Hi', body: 'Hello', url: 'https://photoo.lu' },
    ]);

    expect(results[0]?.deviceNotRegistered).toBe(false);
    expect(results[0]?.error).toBe('MessageRateExceeded');
  });

  it('maps receipts to ok/deviceNotRegistered flags', async () => {
    getPushNotificationReceiptsAsync.mockResolvedValueOnce({
      'ticket-1': { status: 'ok' },
      'ticket-2': { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } },
    });
    const { createExpoPushSender } = await import('./push-sender.js');
    const sender = createExpoPushSender('access-token');

    const receipts = await sender.getReceipts(['ticket-1', 'ticket-2']);

    expect(receipts).toEqual({
      'ticket-1': { ok: true, deviceNotRegistered: false, error: undefined },
      'ticket-2': { ok: false, deviceNotRegistered: true, error: 'DeviceNotRegistered' },
    });
  });
});
