import type { Redis } from 'ioredis';

const PENDING_TICKETS_KEY = 'notify:push-tickets';
const TICKET_KEY_PREFIX = 'notify:push-ticket:';
const TICKET_TTL_SECONDS = 24 * 60 * 60;

export interface DueTicket {
  ticketId: string;
  deviceId: string;
}

// Tickets are stored briefly in Redis so the push-receipts sweep can check
// them ~15 minutes later without holding notify.processor open
// (docs/steps/1A.7-notifications.md "Push").
export interface PushTicketStore {
  store(ticketId: string, deviceId: string): Promise<void>;
  takeDue(olderThanMs: number, now?: number): Promise<DueTicket[]>;
  clear(ticketIds: readonly string[]): Promise<void>;
}

export function createRedisPushTicketStore(redis: Redis): PushTicketStore {
  return {
    async store(ticketId, deviceId) {
      await redis
        .multi()
        .zadd(PENDING_TICKETS_KEY, Date.now(), ticketId)
        .set(`${TICKET_KEY_PREFIX}${ticketId}`, deviceId, 'EX', TICKET_TTL_SECONDS)
        .exec();
    },

    async takeDue(olderThanMs, now = Date.now()) {
      const ticketIds = await redis.zrangebyscore(PENDING_TICKETS_KEY, 0, now - olderThanMs);
      const due: DueTicket[] = [];
      for (const ticketId of ticketIds) {
        const deviceId = await redis.get(`${TICKET_KEY_PREFIX}${ticketId}`);
        if (deviceId) {
          due.push({ ticketId, deviceId });
        }
      }
      return due;
    },

    async clear(ticketIds) {
      if (ticketIds.length === 0) {
        return;
      }
      const multi = redis.multi().zrem(PENDING_TICKETS_KEY, ...ticketIds);
      for (const ticketId of ticketIds) {
        multi.del(`${TICKET_KEY_PREFIX}${ticketId}`);
      }
      await multi.exec();
    },
  };
}
