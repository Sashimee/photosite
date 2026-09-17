import { Controller, Get, HttpException, HttpStatus, Inject } from '@nestjs/common';
import type { HealthResponseSchema, ReadyResponseSchema } from '@photoo/shared';
import type { z } from 'zod';
import { HealthService } from './health.service.js';

type HealthResponse = z.infer<typeof HealthResponseSchema>;
type ReadyResponse = z.infer<typeof ReadyResponseSchema>;

@Controller()
export class HealthController {
  constructor(@Inject(HealthService) private readonly health: HealthService) {}

  @Get('health')
  liveness(): HealthResponse {
    return { status: 'ok' };
  }

  @Get('ready')
  async readiness(): Promise<ReadyResponse> {
    const [database, redis] = await Promise.all([
      this.health.checkDatabase(),
      this.health.checkRedis(),
    ]);

    if (!database || !redis) {
      throw new HttpException(
        {
          code: 'SERVICE_UNAVAILABLE',
          message: 'A dependency is unreachable',
          details: { database: database ? 'ok' : 'down', redis: redis ? 'ok' : 'down' },
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    return { status: 'ok', checks: { database: 'ok', redis: 'ok' } };
  }
}
