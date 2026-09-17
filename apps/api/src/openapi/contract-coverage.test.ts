import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { buildOpenApiDocument } from '@photoo/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../testing/create-test-app.js';
import { TEST_ENV } from '../testing/test-env.js';
import { NOT_YET_IMPLEMENTED } from './not-yet-implemented.js';

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'] as const;

function toFastifyUrl(openApiPath: string): string {
  return openApiPath.replace(/\{([^}]+)\}/g, ':$1');
}

function contractRoutes(): { method: string; path: string }[] {
  const document = buildOpenApiDocument();
  const routes: { method: string; path: string }[] = [];

  for (const [pathKey, pathItem] of Object.entries(document.paths ?? {})) {
    for (const method of HTTP_METHODS) {
      if (method in pathItem) {
        routes.push({ method: method.toUpperCase(), path: toFastifyUrl(pathKey) });
      }
    }
  }

  return routes;
}

describe('contract coverage', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await createTestApp(TEST_ENV);
  });

  afterAll(() => app.close());

  it('every registered contract path is implemented or explicitly deferred', () => {
    const fastify = app.getHttpAdapter().getInstance();

    for (const route of contractRoutes()) {
      const implemented = fastify.hasRoute({ method: route.method, url: route.path });
      const deferred = NOT_YET_IMPLEMENTED.some(
        (entry) => entry.method === route.method && entry.path === route.path,
      );

      expect(
        implemented || deferred,
        `${route.method} ${route.path} is neither implemented nor on the not-yet-implemented list`,
      ).toBe(true);
      expect(
        implemented && deferred,
        `${route.method} ${route.path} is implemented but still on the not-yet-implemented list`,
      ).toBe(false);
    }
  });

  it('the not-yet-implemented list has no stale entries', () => {
    const known = new Set(contractRoutes().map((route) => `${route.method} ${route.path}`));

    for (const entry of NOT_YET_IMPLEMENTED) {
      expect(
        known.has(`${entry.method} ${entry.path}`),
        `${entry.method} ${entry.path} is not in the contract`,
      ).toBe(true);
    }
  });
});
