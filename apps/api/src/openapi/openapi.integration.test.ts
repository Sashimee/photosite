import { buildOpenApiDocument } from '@photoo/shared';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../testing/create-test-app.js';
import { TEST_ENV } from '../testing/test-env.js';

describe('GET /openapi.json', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await createTestApp(TEST_ENV);
  });

  afterAll(() => app.close());

  it('is outside the /v1 prefix and matches the built document', async () => {
    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({ method: 'GET', url: '/openapi.json' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(buildOpenApiDocument());
  });
});
