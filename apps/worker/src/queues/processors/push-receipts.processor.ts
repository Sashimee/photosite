import { Prisma } from '@photoo/db';
import type { Processor } from 'bullmq';
import type { Logger } from 'nestjs-pino';
import type { PushSender } from '../../push/push-sender.js';
import type { PushTicketStore } from '../../push/push-ticket-store.js';

export interface PushReceiptsDeps {
  prisma: { client: { device: { delete(args: { where: { id: string } }): Promise<unknown> } } };
  pushSender: PushSender;
  pushTicketStore: PushTicketStore;
  logger: Logger;
}

// Roughly 15 minutes after send, per Expo's guidance that receipts become
// available "approximately a day" but are usually ready well before that
// (docs/steps/1A.7-notifications.md "Push").
const RECEIPT_DELAY_MS = 15 * 60 * 1000;

async function deleteDeviceIfPresent(
  device: PushReceiptsDeps['prisma']['client']['device'],
  deviceId: string,
): Promise<void> {
  try {
    await device.delete({ where: { id: deviceId } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return;
    }
    throw error;
  }
}

export function createPushReceiptsProcessor(deps: PushReceiptsDeps): Processor {
  return async () => {
    const due = await deps.pushTicketStore.takeDue(RECEIPT_DELAY_MS);
    if (due.length === 0) {
      deps.logger.log({ count: 0 }, 'push-receipts: nothing due');
      return;
    }

    const receipts = await deps.pushSender.getReceipts(due.map((ticket) => ticket.ticketId));
    let removedDevices = 0;
    for (const ticket of due) {
      const receipt = receipts[ticket.ticketId];
      if (receipt?.deviceNotRegistered) {
        await deleteDeviceIfPresent(deps.prisma.client.device, ticket.deviceId);
        removedDevices += 1;
      }
    }
    await deps.pushTicketStore.clear(due.map((ticket) => ticket.ticketId));

    deps.logger.log({ count: due.length, removedDevices }, 'push-receipts: processed due tickets');
  };
}
