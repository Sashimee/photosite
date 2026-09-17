import { createPrismaClient, type PrismaClient } from '@photoo/db';
import type { OnApplicationShutdown } from '@nestjs/common';
import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, type Env } from '../config/env.js';

@Injectable()
export class PrismaService implements OnApplicationShutdown {
  readonly client: PrismaClient;

  constructor(@Inject(APP_CONFIG) config: Env) {
    this.client = createPrismaClient(config.DATABASE_URL);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.client.$disconnect();
  }
}
