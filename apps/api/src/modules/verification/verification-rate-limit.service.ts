import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  RedisRateLimiter,
  type RateLimitRule,
} from '../../common/rate-limit/redis-rate-limiter.js';

const ONE_HOUR = 60 * 60;
const ONE_DAY = 24 * ONE_HOUR;

const CREATE_CASE_RULE: RateLimitRule = { windowSeconds: ONE_DAY, max: 5 };
const SUBMIT_CASE_RULE: RateLimitRule = { windowSeconds: ONE_DAY, max: 10 };
const UPDATE_CASE_RULE: RateLimitRule = { windowSeconds: ONE_DAY, max: 30 };
const ATTACH_DOCUMENT_RULE: RateLimitRule = { windowSeconds: ONE_DAY, max: 30 };
const ADMIN_DOCUMENT_URL_RULE: RateLimitRule = { windowSeconds: ONE_HOUR, max: 120 };

@Injectable()
export class VerificationRateLimitService {
  constructor(@Inject(RedisRateLimiter) private readonly limiter: RedisRateLimiter) {}

  async enforceCreate(userId: string): Promise<void> {
    await this.enforce(
      'verification:case-create:account',
      userId,
      CREATE_CASE_RULE,
      'Too many verification cases started. Try again later.',
    );
  }

  async enforceSubmit(userId: string): Promise<void> {
    await this.enforce(
      'verification:case-submit:account',
      userId,
      SUBMIT_CASE_RULE,
      'Too many verification submissions. Try again later.',
    );
  }

  async enforceUpdate(userId: string): Promise<void> {
    await this.enforce(
      'verification:case-update:account',
      userId,
      UPDATE_CASE_RULE,
      'Too many verification case updates. Try again later.',
    );
  }

  async enforceAttachDocument(userId: string): Promise<void> {
    await this.enforce(
      'verification:case-document-attach:account',
      userId,
      ATTACH_DOCUMENT_RULE,
      'Too many document uploads. Try again later.',
    );
  }

  async enforceAdminDocumentUrl(adminId: string): Promise<void> {
    await this.enforce(
      'verification:admin-document-url:admin',
      adminId,
      ADMIN_DOCUMENT_URL_RULE,
      'Too many document links requested. Try again later.',
    );
  }

  private async enforce(
    scope: string,
    key: string,
    rule: RateLimitRule,
    message: string,
  ): Promise<void> {
    const result = await this.limiter.consume(scope, key, rule);
    if (!result.allowed) {
      throw new HttpException(
        {
          code: 'TOO_MANY_REQUESTS',
          message,
          details: { retryAfterSeconds: result.retryAfterSeconds },
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }
}
