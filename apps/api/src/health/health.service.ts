import { Inject, Injectable } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../redis/redis.service.js';

const CHECK_TIMEOUT_MS = 2000;

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer!: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`timed out after ${String(ms)}ms`));
    }, ms);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

@Injectable()
export class HealthService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(Logger) private readonly logger: Logger,
  ) {}

  async checkDatabase(): Promise<boolean> {
    try {
      await withTimeout(this.prisma.client.$queryRaw`SELECT 1`, CHECK_TIMEOUT_MS);
      return true;
    } catch (error) {
      this.logger.warn({ err: error }, 'readiness: database check failed');
      return false;
    }
  }

  async checkRedis(): Promise<boolean> {
    try {
      await withTimeout(this.redis.client.ping(), CHECK_TIMEOUT_MS);
      return true;
    } catch (error) {
      this.logger.warn({ err: error }, 'readiness: redis check failed');
      return false;
    }
  }
}
