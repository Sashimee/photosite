import type { Redis } from 'ioredis';

const PENDING_TICKETS_KEY = 'notify:push-tickets';
const TICKET_KEY_PREFIX = 'notify:push-ticket:';
const TICKET_TTL_SECONDS = 24 * 60 * 60;

export interface DueTicket {
  ticketId: string;
  deviceId: string;
}

// Backs the push-receipts sweep (checks each ticket ~15 minutes later).
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
      const orphaned: string[] = [];
      for (const ticketId of ticketIds) {
        const deviceId = await redis.get(`${TICKET_KEY_PREFIX}${ticketId}`);
        if (deviceId) {
          due.push({ ticketId, deviceId });
        } else {
          orphaned.push(ticketId);
        }
      }
      if (orphaned.length > 0) {
        await redis.zrem(PENDING_TICKETS_KEY, ...orphaned);
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
