import { Expo, type ExpoPushMessage, type ExpoPushReceipt } from 'expo-server-sdk';

export interface PushMessage {
  to: string;
  title: string;
  body: string;
  url: string;
}

export interface PushSendResult {
  to: string;
  ticketId: string | null;
  deviceNotRegistered: boolean;
}

export interface PushReceiptResult {
  ok: boolean;
  deviceNotRegistered: boolean;
}

export interface PushSender {
  send(messages: readonly PushMessage[]): Promise<PushSendResult[]>;
  getReceipts(ticketIds: readonly string[]): Promise<Record<string, PushReceiptResult>>;
}

export function createExpoPushSender(accessToken: string | undefined): PushSender {
  const expo = new Expo(accessToken ? { accessToken } : undefined);

  return {
    async send(messages) {
      const expoMessages: ExpoPushMessage[] = messages.map((message) => ({
        to: message.to,
        title: message.title,
        body: message.body,
        data: { url: message.url },
        sound: 'default',
      }));

      const results: PushSendResult[] = [];
      let cursor = 0;
      for (const chunk of expo.chunkPushNotifications(expoMessages)) {
        const tickets = await expo.sendPushNotificationsAsync(chunk);
        for (const ticket of tickets) {
          const to = messages[cursor]?.to;
          cursor += 1;
          if (!to) {
            continue;
          }
          if (ticket.status === 'ok') {
            results.push({ to, ticketId: ticket.id, deviceNotRegistered: false });
          } else {
            results.push({
              to,
              ticketId: null,
              deviceNotRegistered: ticket.details?.error === 'DeviceNotRegistered',
            });
          }
        }
      }
      return results;
    },

    async getReceipts(ticketIds) {
      const receipts: Record<string, ExpoPushReceipt> = {};
      for (const chunk of expo.chunkPushNotificationReceiptIds([...ticketIds])) {
        Object.assign(receipts, await expo.getPushNotificationReceiptsAsync(chunk));
      }
      return Object.fromEntries(
        Object.entries(receipts).map(([id, receipt]) => [
          id,
          {
            ok: receipt.status === 'ok',
            deviceNotRegistered:
              receipt.status === 'error' && receipt.details?.error === 'DeviceNotRegistered',
          },
        ]),
      );
    },
  };
}
