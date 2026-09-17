import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../testing/create-test-app.js';
import { requireIntegrationEnv } from '../testing/require-integration-env.js';
import { TEST_ENV, UNREACHABLE_TEST_ENV } from '../testing/test-env.js';

describe('GET /health', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await createTestApp(TEST_ENV);
  });

  afterAll(() => app.close());

  it('is outside the /v1 prefix and always reports ok', async () => {
    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });
});

describe('GET /ready without a reachable database or Redis', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await createTestApp(UNREACHABLE_TEST_ENV);
  });

  afterAll(() => app.close());

  it('returns a SERVICE_UNAVAILABLE ApiError shape', async () => {
    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({ method: 'GET', url: '/ready' });
    expect(response.statusCode).toBe(503);
    const body = response.json<{
      code: string;
      message: string;
      details: unknown;
      requestId: string;
    }>();
    expect(body.code).toBe('SERVICE_UNAVAILABLE');
    expect(typeof body.requestId).toBe('string');
    expect(body.details).toEqual({ database: 'down', redis: 'down' });
  });
});

const testEnv = requireIntegrationEnv(['TEST_DATABASE_URL', 'REDIS_URL']);

describe('GET /ready with the local dev stack', () => {
  if (!testEnv) {
    it.skip('reports ok for both checks (skipped: TEST_DATABASE_URL or REDIS_URL is not set)', () =>
      undefined);
    return;
  }

  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await createTestApp({
      ...TEST_ENV,
      DATABASE_URL: testEnv.TEST_DATABASE_URL,
      REDIS_URL: testEnv.REDIS_URL,
    });
  });

  afterAll(() => app.close());

  it('reports ok for both checks', async () => {
    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({ method: 'GET', url: '/ready' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok', checks: { database: 'ok', redis: 'ok' } });
  });
});
