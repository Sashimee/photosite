import { Inject, Injectable } from '@nestjs/common';
import { RedisService } from '../../redis/redis.service.js';

export const PRESENCE_TTL_SECONDS = 60;

function presenceKey(userId: string): string {
  return `chat:presence:${userId}`;
}

// Atomic stale-cleanup + capacity-check + join, so two sockets racing to
// connect for the same user can't both slip past the cap.
const TRY_JOIN_SCRIPT = `
local key = KEYS[1]
local member = ARGV[1]
local now = tonumber(ARGV[2])
local staleBefore = tonumber(ARGV[3])
local maxCount = tonumber(ARGV[4])
local ttl = tonumber(ARGV[5])
redis.call('ZREMRANGEBYSCORE', key, '-inf', staleBefore)
local count = redis.call('ZCARD', key)
if count >= maxCount then
  return 0
end
redis.call('ZADD', key, now, member)
redis.call('EXPIRE', key, ttl)
return 1
`;

// A sorted-set-of-sockets-per-user, scored by last heartbeat, replaces
// `fetchSockets()` (S3, docs/steps/1A.6-chat.md security checkpoint): the
// Redis adapter's `fetchSockets` serialises full socket data, including
// handshake headers, across the pub/sub channel, so it never belongs in a
// hot path like the connection cap or an online check. A crashed instance
// simply stops refreshing its sockets' scores; they age out of the window
// within PRESENCE_TTL_SECONDS instead of leaking forever.
@Injectable()
export class ChatPresenceService {
  constructor(@Inject(RedisService) private readonly redisService: RedisService) {}

  async tryJoin(userId: string, socketId: string, maxCount: number): Promise<boolean> {
    const now = Date.now();
    const staleBefore = now - PRESENCE_TTL_SECONDS * 1000;
    const result = await this.redisService.client.eval(
      TRY_JOIN_SCRIPT,
      1,
      presenceKey(userId),
      socketId,
      String(now),
      String(staleBefore),
      String(maxCount),
      String(PRESENCE_TTL_SECONDS),
    );
    return result === 1;
  }

  async heartbeat(userId: string, socketId: string): Promise<void> {
    const key = presenceKey(userId);
    await this.redisService.client.zadd(key, Date.now(), socketId);
    await this.redisService.client.expire(key, PRESENCE_TTL_SECONDS);
  }

  async leave(userId: string, socketId: string): Promise<void> {
    await this.redisService.client.zrem(presenceKey(userId), socketId);
  }

  async isOnline(userId: string): Promise<boolean> {
    const key = presenceKey(userId);
    const staleBefore = Date.now() - PRESENCE_TTL_SECONDS * 1000;
    await this.redisService.client.zremrangebyscore(key, '-inf', staleBefore);
    const count = await this.redisService.client.zcard(key);
    return count > 0;
  }
}
