import type { Processor } from 'bullmq';
import type { Logger } from 'nestjs-pino';
import {
  deleteDeviceIfPresent,
  type DeviceDeleteClient,
} from '../../push/delete-device-if-present.js';
import type { PushSender } from '../../push/push-sender.js';
import type { PushTicketStore } from '../../push/push-ticket-store.js';

export interface PushReceiptsDeps {
  prisma: { client: { device: DeviceDeleteClient } };
  pushSender: PushSender;
  pushTicketStore: PushTicketStore;
  logger: Logger;
}

// Roughly 15 minutes after send, per Expo's guidance that receipts become
// available "approximately a day" but are usually ready well before that
// (docs/steps/1A.7-notifications.md "Push").
const RECEIPT_DELAY_MS = 15 * 60 * 1000;

export function createPushReceiptsProcessor(deps: PushReceiptsDeps): Processor {
  return async () => {
    const due = await deps.pushTicketStore.takeDue(RECEIPT_DELAY_MS);
    if (due.length === 0) {
      deps.logger.log({ count: 0 }, 'push-receipts: nothing due');
      return;
    }

    const receipts = await deps.pushSender.getReceipts(due.map((ticket) => ticket.ticketId));
    let removedDevices = 0;
    // Only tickets with a resolved receipt are cleared here; an
    // unresolved one is left in the store (takeDue only re-surfaces it
    // once it is due again) until its hash key expires (~24h), at which
    // point takeDue treats it as orphaned and drops it.
    const resolvedTicketIds: string[] = [];
    for (const ticket of due) {
      const receipt = receipts[ticket.ticketId];
      if (!receipt) {
        continue;
      }
      resolvedTicketIds.push(ticket.ticketId);
      if (receipt.deviceNotRegistered) {
        await deleteDeviceIfPresent(deps.prisma.client.device, ticket.deviceId);
        removedDevices += 1;
      } else if (!receipt.ok) {
        deps.logger.warn(
          { ticketId: ticket.ticketId, error: receipt.error },
          'push-receipts: delivery failed',
        );
      }
    }
    await deps.pushTicketStore.clear(resolvedTicketIds);

    deps.logger.log(
      { count: due.length, resolved: resolvedTicketIds.length, removedDevices },
      'push-receipts: processed due tickets',
    );
  };
}
