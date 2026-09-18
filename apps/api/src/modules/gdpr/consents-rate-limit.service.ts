import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  RedisRateLimiter,
  type RateLimitRule,
} from '../../common/rate-limit/redis-rate-limiter.js';

const ONE_HOUR = 60 * 60;

// Public and anonymous-capable, like reports (reports-rate-limit.service.ts).
// `anonymousId` is attacker-controlled and free to generate, so it cannot be
// the rate-limit key; the IP rule is the only defence for a signed-out
// caller. The account rule bounds a signed-in caller regardless of IP.
const CONSENTS_IP_RULE: RateLimitRule = { windowSeconds: ONE_HOUR, max: 20 };
const CONSENTS_ACCOUNT_RULE: RateLimitRule = { windowSeconds: ONE_HOUR, max: 40 };

@Injectable()
export class ConsentsRateLimitService {
  constructor(@Inject(RedisRateLimiter) private readonly limiter: RedisRateLimiter) {}

  async enforce(ip: string | undefined, userId: string | null): Promise<void> {
    const ipResult = await this.limiter.consume(
      'consents:create:ip',
      ip ?? 'unknown',
      CONSENTS_IP_RULE,
    );
    if (!ipResult.allowed) {
      this.throwTooManyRequests(ipResult.retryAfterSeconds);
    }

    if (userId) {
      const accountResult = await this.limiter.consume(
        'consents:create:account',
        userId,
        CONSENTS_ACCOUNT_RULE,
      );
      if (!accountResult.allowed) {
        this.throwTooManyRequests(accountResult.retryAfterSeconds);
      }
    }
  }

  private throwTooManyRequests(retryAfterSeconds: number): never {
    throw new HttpException(
      {
        code: 'TOO_MANY_REQUESTS',
        message: 'Too many consent updates. Try again later.',
        details: { retryAfterSeconds },
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
