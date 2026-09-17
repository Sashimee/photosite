import type { TestingModule } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext } from '../testing/create-test-context.js';
import { requireIntegrationEnv } from '../testing/require-integration-env.js';
import { TEST_ENV, UNREACHABLE_TEST_ENV } from '../testing/test-env.js';

describe('GET /health', () => {
  const port = 4103;
  let moduleRef: TestingModule;

  beforeAll(async () => {
    moduleRef = await createTestContext({ ...TEST_ENV, HEALTH_PORT: port });
  });

  afterAll(() => moduleRef.close());

  it('always reports ok', async () => {
    const response = await fetch(`http://127.0.0.1:${String(port)}/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
  });

  it('returns 404 for an unknown path', async () => {
    const response = await fetch(`http://127.0.0.1:${String(port)}/nope`);
    expect(response.status).toBe(404);
  });

  it('returns 404 for a non-GET method', async () => {
    const response = await fetch(`http://127.0.0.1:${String(port)}/health`, { method: 'POST' });
    expect(response.status).toBe(404);
  });
});

describe('GET /ready without a reachable database or Redis', () => {
  const port = 4104;
  let moduleRef: TestingModule;

  beforeAll(async () => {
    moduleRef = await createTestContext({ ...UNREACHABLE_TEST_ENV, HEALTH_PORT: port });
  });

  afterAll(() => moduleRef.close());

  it('returns a 503 with both checks reported down', async () => {
    const response = await fetch(`http://127.0.0.1:${String(port)}/ready`);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      status: 'error',
      checks: { database: 'down', redis: 'down' },
    });
  });
});

const testEnv = requireIntegrationEnv(['TEST_DATABASE_URL', 'REDIS_URL']);

describe('GET /ready with the local dev stack', () => {
  if (!testEnv) {
    it.skip('reports ok for both checks (skipped: TEST_DATABASE_URL or REDIS_URL is not set)', () =>
      undefined);
    return;
  }

  const port = 4105;
  let moduleRef: TestingModule;

  beforeAll(async () => {
    moduleRef = await createTestContext({
      ...TEST_ENV,
      DATABASE_URL: testEnv.TEST_DATABASE_URL,
      REDIS_URL: testEnv.REDIS_URL,
      HEALTH_PORT: port,
    });
  });

  afterAll(() => moduleRef.close());

  it('reports ok for both checks', async () => {
    const response = await fetch(`http://127.0.0.1:${String(port)}/ready`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: 'ok',
      checks: { database: 'ok', redis: 'ok' },
    });
  });
});
