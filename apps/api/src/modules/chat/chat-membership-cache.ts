import { Inject, Injectable } from '@nestjs/common';
import { RedisService } from '../../redis/redis.service.js';

const MEMBERSHIP_TTL_SECONDS = 60;

function membershipKey(conversationId: string, userId: string): string {
  return `chat:membership:${conversationId}:${userId}`;
}

// Backs `conversation:join` (docs/steps/1A.6-chat.md "checks membership in
// the DB and caches it in Redis for 60 s"); REST handlers still hit the DB
// directly since they already need the full participant row. Only "is a
// member" is cached: a negative result would keep rejecting a user added to
// the conversation moments later (e.g. a fresh quote conversation), and a
// stale positive is the safe direction to fail toward for 60 s.
@Injectable()
export class ChatMembershipCache {
  constructor(@Inject(RedisService) private readonly redisService: RedisService) {}

  async isMember(conversationId: string, userId: string): Promise<boolean | undefined> {
    const value = await this.redisService.client.get(membershipKey(conversationId, userId));
    return value === '1' ? true : undefined;
  }

  async markMember(conversationId: string, userId: string): Promise<void> {
    await this.redisService.client.set(
      membershipKey(conversationId, userId),
      '1',
      'EX',
      MEMBERSHIP_TTL_SECONDS,
    );
  }

  async invalidate(conversationId: string, userId: string): Promise<void> {
    await this.redisService.client.del(membershipKey(conversationId, userId));
  }
}
