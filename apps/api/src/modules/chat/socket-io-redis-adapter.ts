import type { IncomingMessage } from 'node:http';
import type { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { Redis } from 'ioredis';
import type { Server, ServerOptions } from 'socket.io';
import {
  RedisRateLimiter,
  type RateLimitRule,
} from '../../common/rate-limit/redis-rate-limiter.js';
import { APP_CONFIG, type Env } from '../../config/env.js';

const CONNECTION_ATTEMPT_RULE: RateLimitRule = { windowSeconds: 60, max: 60 };

export function resolveClientIp(
  remoteAddress: string | undefined,
  forwardedFor: string | string[] | undefined,
  trustedProxies: readonly string[],
): string {
  const immediate = remoteAddress ?? 'unknown';
  if (!forwardedFor || trustedProxies.length === 0 || !trustedProxies.includes(immediate)) {
    return immediate;
  }
  const chain = Array.isArray(forwardedFor) ? forwardedFor.join(',') : forwardedFor;
  const first = chain.split(',')[0]?.trim();
  return first && first.length > 0 ? first : immediate;
}

// Own Redis connections, not the shared RedisService: pub/sub clients must
// stay subscribed for the adapter's lifetime, unlike the app's other
// give-up-on-failure connections.
export class RedisIoAdapter extends IoAdapter {
  private pubClient: Redis | undefined;
  private subClient: Redis | undefined;
  private adapterConstructor: ReturnType<typeof createAdapter> | undefined;
  private readonly config: Env;
  private readonly rateLimiter: RedisRateLimiter;

  constructor(
    private readonly app: INestApplicationContext,
    private readonly redisUrl: string,
  ) {
    super(app);
    this.config = app.get(APP_CONFIG);
    this.rateLimiter = app.get(RedisRateLimiter);
  }

  connectToRedis(): void {
    // Redis PUBLISH/SUBSCRIBE crosses every logical database on the server
    // regardless of which one `this.redisUrl` SELECTs, so the per-worktree
    // scoping in packages/db/src/testing/scoped-redis-url.ts (ordinary keys
    // only - BullMQ queues, rate limits) leaves this adapter's channel
    // unscoped. Known gap (#225 follow-up), not worked around here.
    this.pubClient = new Redis(this.redisUrl, {
      maxRetriesPerRequest: null,
      retryStrategy: (times) => Math.min(times * 200, 5000),
    });
    this.subClient = this.pubClient.duplicate();
    // Same rationale as RedisService's listener: retryStrategy above owns
    // reconnection.
    this.pubClient.on('error', () => undefined);
    this.subClient.on('error', () => undefined);
    this.adapterConstructor = createAdapter(this.pubClient, this.subClient);
  }

  override createIOServer(port: number, options?: ServerOptions): Server {
    const merged: Partial<ServerOptions> = {
      ...options,
      cors: { origin: this.config.WEB_ORIGINS, credentials: true },
      allowRequest: (request, callback) => {
        void this.allowRequest(request).then(
          (allowed) => {
            callback(allowed ? null : 'forbidden', allowed);
          },
          () => {
            callback('forbidden', false);
          },
        );
      },
    };
    const server: Server = super.createIOServer(port, merged as ServerOptions);
    if (this.adapterConstructor) {
      server.adapter(this.adapterConstructor);
    }
    return server;
  }

  private async allowRequest(request: IncomingMessage): Promise<boolean> {
    const secFetchSite = request.headers['sec-fetch-site'];
    if (secFetchSite === 'cross-site') {
      return false;
    }

    const clientIp = resolveClientIp(
      request.socket.remoteAddress,
      request.headers['x-forwarded-for'],
      this.config.TRUSTED_PROXIES,
    );
    const result = await this.rateLimiter.consume(
      'chat:socket:connect:ip',
      clientIp,
      CONNECTION_ATTEMPT_RULE,
    );
    return result.allowed;
  }

  override async dispose(): Promise<void> {
    await Promise.all([this.pubClient?.quit(), this.subClient?.quit()]);
  }
}
