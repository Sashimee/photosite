import type { OnApplicationShutdown } from '@nestjs/common';
import { Inject, Injectable } from '@nestjs/common';
import { Redis } from 'ioredis';
import { APP_CONFIG, type Env } from '../config/env.js';

@Injectable()
export class RedisService implements OnApplicationShutdown {
  readonly client: Redis;

  constructor(@Inject(APP_CONFIG) config: Env) {
    this.client = new Redis(config.REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
    });

    this.client.on('error', () => {
      // Connection failures surface to callers through the rejected command
      // promise (see HealthService); this listener only stops ioredis from
      // logging an "Unhandled error event" warning for the same failure.
    });
  }

  onApplicationShutdown(): void {
    this.client.disconnect();
  }
}
