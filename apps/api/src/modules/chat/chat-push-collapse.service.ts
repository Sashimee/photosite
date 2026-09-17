import { Inject, Injectable } from '@nestjs/common';
import { RedisService } from '../../redis/redis.service.js';

const COLLAPSE_WINDOW_SECONDS = 10 * 60;

function collapseKey(conversationId: string, recipientId: string): string {
  return `chat:push-collapse:${conversationId}:${recipientId}`;
}

@Injectable()
export class ChatPushCollapseService {
  constructor(@Inject(RedisService) private readonly redisService: RedisService) {}

  async shouldSend(conversationId: string, recipientId: string): Promise<boolean> {
    const result = await this.redisService.client.set(
      collapseKey(conversationId, recipientId),
      '1',
      'EX',
      COLLAPSE_WINDOW_SECONDS,
      'NX',
    );
    return result === 'OK';
  }

  // Called when the notify() enqueue itself fails, so the window doesn't
  // eat the next real attempt for a push that never actually went out.
  async clear(conversationId: string, recipientId: string): Promise<void> {
    await this.redisService.client.del(collapseKey(conversationId, recipientId));
  }
}
