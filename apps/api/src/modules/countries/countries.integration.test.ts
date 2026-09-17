import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../../testing/create-test-app.js';
import { requireIntegrationEnv } from '../../testing/require-integration-env.js';
import { TEST_ENV } from '../../testing/test-env.js';

const testEnv = requireIntegrationEnv(['TEST_DATABASE_URL', 'REDIS_URL']);

interface CountryBody {
  code: string;
  name: string;
  currency: string;
  defaultLocale: string;
}

describe('countries integration', () => {
  if (!testEnv) {
    it.skip('skipped: TEST_DATABASE_URL or REDIS_URL is not set', () => undefined);
    return;
  }

  let app: NestFastifyApplication;

  function fastify() {
    return app.getHttpAdapter().getInstance();
  }

  beforeAll(async () => {
    app = await createTestApp({
      ...TEST_ENV,
      DATABASE_URL: testEnv.TEST_DATABASE_URL,
      REDIS_URL: testEnv.REDIS_URL,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /v1/countries', () => {
    it('sets a 1 hour public Cache-Control header', async () => {
      const response = await fastify().inject({ method: 'GET', url: '/v1/countries' });
      expect(response.statusCode).toBe(200);
      expect(response.headers['cache-control']).toBe('public, max-age=3600');
    });

    it('includes the seeded, enabled Luxembourg row with its public fields', async () => {
      const response = await fastify().inject({ method: 'GET', url: '/v1/countries' });
      const body = response.json<CountryBody[]>();
      const lu = body.find((country) => country.code === 'LU');
      expect(lu).toMatchObject({
        code: 'LU',
        name: 'Luxembourg',
        currency: 'EUR',
        defaultLocale: 'fr',
      });
    });

    it('never exposes internal country configuration', async () => {
      const response = await fastify().inject({ method: 'GET', url: '/v1/countries' });
      const body = response.json<Record<string, unknown>[]>();
      for (const country of body) {
        expect(country).not.toHaveProperty('vatRate');
        expect(country).not.toHaveProperty('requiredDocuments');
        expect(country).not.toHaveProperty('legalTexts');
        expect(country).not.toHaveProperty('enabled');
      }
    });
  });
});
