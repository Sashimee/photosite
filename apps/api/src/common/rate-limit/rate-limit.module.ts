import { Global, Module } from '@nestjs/common';
import { RedisRateLimiter } from './redis-rate-limiter.js';

@Global()
@Module({
  providers: [RedisRateLimiter],
  exports: [RedisRateLimiter],
})
export class RateLimitModule {}
