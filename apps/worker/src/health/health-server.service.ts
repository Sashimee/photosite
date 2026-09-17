import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { createServer } from 'node:http';
import type { OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { Inject, Injectable } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { APP_CONFIG, type Env } from '../config/env.js';
import { HealthService } from './health.service.js';

interface ReadyBody {
  status: 'ok' | 'error';
  checks: { database: 'ok' | 'down'; redis: 'ok' | 'down' };
}

@Injectable()
export class HealthServerService implements OnApplicationBootstrap, OnApplicationShutdown {
  private server: Server | undefined;

  constructor(
    @Inject(APP_CONFIG) private readonly config: Env,
    @Inject(HealthService) private readonly health: HealthService,
    @Inject(Logger) private readonly logger: Logger,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const server = createServer((request, response) => {
      this.handle(request, response).catch((error: unknown) => {
        this.logger.error({ err: error }, 'health server: request handler failed');
        if (!response.headersSent) {
          response.writeHead(500);
        }
        response.end();
      });
    });
    this.server = server;

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.config.HEALTH_PORT, '0.0.0.0', () => {
        server.removeListener('error', reject);
        resolve();
      });
    });
  }

  async onApplicationShutdown(): Promise<void> {
    const server = this.server;
    if (!server) {
      return;
    }
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.method !== 'GET') {
      response.writeHead(404);
      response.end();
      return;
    }

    if (request.url === '/health') {
      this.respondJson(response, 200, { status: 'ok' });
      return;
    }

    if (request.url === '/ready') {
      const [database, redis] = await Promise.all([
        this.health.checkDatabase(),
        this.health.checkRedis(),
      ]);
      const body: ReadyBody = {
        status: database && redis ? 'ok' : 'error',
        checks: { database: database ? 'ok' : 'down', redis: redis ? 'ok' : 'down' },
      };
      this.respondJson(response, database && redis ? 200 : 503, body);
      return;
    }

    response.writeHead(404);
    response.end();
  }

  private respondJson(response: ServerResponse, statusCode: number, body: unknown): void {
    const payload = JSON.stringify(body);
    response.writeHead(statusCode, { 'content-type': 'application/json' });
    response.end(payload);
  }
}
