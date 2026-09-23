import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  RedisRateLimiter,
  type RateLimitRule,
} from '../../common/rate-limit/redis-rate-limiter.js';

const ONE_DAY = 24 * 60 * 60;

// docs/steps/1A.13-professionals.md "Rate limits and abuse": a free job
// board is a spam target, and these limits are the only defence in Phase 1.
// CREATE_RULE is higher than PUBLISH_RULE (drafts are cheap, but role
// self-grant plus no email-verification precondition means an account can
// still be automated) so a legitimate professional editing several drafts
// before publishing never trips it.
const CREATE_RULE: RateLimitRule = { windowSeconds: ONE_DAY, max: 20 };
const PUBLISH_RULE: RateLimitRule = { windowSeconds: ONE_DAY, max: 10 };
const APPLY_RULE: RateLimitRule = { windowSeconds: ONE_DAY, max: 30 };

@Injectable()
export class JobBoardRateLimitService {
  constructor(@Inject(RedisRateLimiter) private readonly limiter: RedisRateLimiter) {}

  async enforceCreate(accountId: string): Promise<void> {
    await this.enforce('job-board:create:account', accountId, CREATE_RULE, 'draft offers created');
  }

  async enforcePublish(accountId: string): Promise<void> {
    await this.enforce('job-board:publish:account', accountId, PUBLISH_RULE, 'offers published');
  }

  async enforceApply(photographerId: string): Promise<void> {
    await this.enforce(
      'job-board:apply:photographer',
      photographerId,
      APPLY_RULE,
      'applications submitted',
    );
  }

  private async enforce(
    scope: string,
    key: string,
    rule: RateLimitRule,
    subject: string,
  ): Promise<void> {
    const result = await this.limiter.consume(scope, key, rule);
    if (!result.allowed) {
      throw new HttpException(
        {
          code: 'TOO_MANY_REQUESTS',
          message: `Too many ${subject} today. Try again later.`,
          details: { retryAfterSeconds: result.retryAfterSeconds },
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }
}
