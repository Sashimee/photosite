import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  RedisRateLimiter,
  type RateLimitRule,
} from '../../common/rate-limit/redis-rate-limiter.js';

const ONE_MINUTE = 60;
const ONE_HOUR = 60 * ONE_MINUTE;
const ONE_DAY = 24 * ONE_HOUR;

const MESSAGE_MINUTE_RULE: RateLimitRule = { windowSeconds: ONE_MINUTE, max: 30 };
const MESSAGE_MINUTE_IP_RULE: RateLimitRule = { windowSeconds: ONE_MINUTE, max: 100 };
const MESSAGE_DAY_RULE: RateLimitRule = { windowSeconds: ONE_DAY, max: 500 };
const REPORT_RULE: RateLimitRule = { windowSeconds: ONE_HOUR, max: 5 };
const READ_RULE: RateLimitRule = { windowSeconds: ONE_MINUTE, max: 120 };

export function tooManyRequests(retryAfterSeconds: number): HttpException {
  return new HttpException(
    {
      code: 'TOO_MANY_REQUESTS',
      message: 'Too many requests. Try again later.',
      details: { retryAfterSeconds },
    },
    HttpStatus.TOO_MANY_REQUESTS,
  );
}

// Shared by the REST controller and the socket gateway (docs/steps/1A.6-chat.md
// "Messages: 30 a minute and 500 a day per user ... shared by REST and
// socket"), so a user cannot bypass one transport's limit through the other.
// The IP dimension only applies to REST: a socket's abuse surface is already
// bounded by the per-connection event limiter and the per-IP connection cap.
@Injectable()
export class ChatRateLimitService {
  constructor(@Inject(RedisRateLimiter) private readonly limiter: RedisRateLimiter) {}

  async enforceSendMessage(userId: string, ip?: string): Promise<void> {
    if (ip) {
      await this.enforce('chat:message:minute:ip', ip, MESSAGE_MINUTE_IP_RULE);
    }
    await this.enforce('chat:message:minute', userId, MESSAGE_MINUTE_RULE);
    await this.enforce('chat:message:day', userId, MESSAGE_DAY_RULE);
  }

  async enforceReport(userId: string): Promise<void> {
    await this.enforce('chat:report', userId, REPORT_RULE);
  }

  async enforceRead(userId: string): Promise<void> {
    await this.enforce('chat:read', userId, READ_RULE);
  }

  private async enforce(scope: string, key: string, rule: RateLimitRule): Promise<void> {
    const result = await this.limiter.consume(scope, key, rule);
    if (!result.allowed) {
      throw tooManyRequests(result.retryAfterSeconds);
    }
  }
}
