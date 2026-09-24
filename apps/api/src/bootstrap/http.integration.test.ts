import { randomUUID } from 'node:crypto';
import { Body, Controller, Get, Post } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { Logger } from 'nestjs-pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AllExceptionsFilter } from '../common/filters/all-exceptions.filter.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { TEST_ENV } from '../testing/test-env.js';
import { configureApp } from './configure-app.js';
import { createFastifyAdapter } from './fastify-adapter.js';

const CreateWidgetSchema = z
  .object({
    name: z.string().min(1),
  })
  .strict();

interface ApiErrorBody {
  code: string;
  message: string;
  details?: unknown;
  requestId: string;
}

@Controller('widgets')
class FixtureController {
  @Post()
  create(
    @Body(new ZodValidationPipe(CreateWidgetSchema)) body: z.infer<typeof CreateWidgetSchema>,
  ) {
    return body;
  }

  @Get('boom')
  boom(): never {
    throw new Error('unexpected failure: password=hunter2');
  }
}

describe('http bootstrap', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [FixtureController],
      providers: [
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
        { provide: Logger, useValue: { error: () => undefined, log: () => undefined } },
      ],
    }).compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(createFastifyAdapter());
    await configureApp(app, TEST_ENV);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(() => app.close());

  it('accepts a valid body and returns the parsed data', async () => {
    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'POST',
        url: '/v1/widgets',
        payload: { name: 'Widget' },
      });
    expect(response.statusCode).toBe(201);
    expect(response.json<{ name: string }>()).toEqual({ name: 'Widget' });
  });

  it('returns a VALIDATION_ERROR ApiError shape for an invalid body', async () => {
    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'POST',
        url: '/v1/widgets',
        payload: { name: '' },
      });
    expect(response.statusCode).toBe(400);
    const body = response.json<ApiErrorBody>();
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.message).toBe('Request validation failed');
    expect(Array.isArray(body.details)).toBe(true);
    expect(typeof body.requestId).toBe('string');
  });

  it('rejects an unknown key on a strict schema with the same 400 shape', async () => {
    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'POST',
        url: '/v1/widgets',
        payload: { name: 'Widget', extra: 'nope' },
      });
    expect(response.statusCode).toBe(400);
    expect(response.json<ApiErrorBody>().code).toBe('VALIDATION_ERROR');
  });

  it('returns a NOT_FOUND ApiError shape for an unmatched route', async () => {
    const response = await app.getHttpAdapter().getInstance().inject({
      method: 'GET',
      url: '/v1/does-not-exist',
    });
    expect(response.statusCode).toBe(404);
    const body = response.json<ApiErrorBody>();
    expect(body.code).toBe('NOT_FOUND');
    expect(typeof body.requestId).toBe('string');
  });

  it('maps an unexpected error to a generic 500 without leaking details', async () => {
    const response = await app.getHttpAdapter().getInstance().inject({
      method: 'GET',
      url: '/v1/widgets/boom',
    });
    expect(response.statusCode).toBe(500);
    const body = response.json<ApiErrorBody>();
    expect(body).toEqual({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Internal server error',
      requestId: expect.any(String) as string,
    });
    expect(JSON.stringify(body)).not.toMatch(/hunter2/);
  });

  it('echoes a valid x-request-id header back on the response', async () => {
    const requestId = randomUUID();
    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'GET',
        url: '/v1/does-not-exist',
        headers: { 'x-request-id': requestId },
      });
    expect(response.headers['x-request-id']).toBe(requestId);
    expect(response.json<ApiErrorBody>().requestId).toBe(requestId);
  });

  it('generates a fresh request id when the header is not a valid UUID', async () => {
    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'GET',
        url: '/v1/does-not-exist',
        headers: { 'x-request-id': 'not-a-uuid' },
      });
    expect(response.headers['x-request-id']).not.toBe('not-a-uuid');
    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it('echoes PHOTOO_REVISION on x-photoo-revision, defaulting to "unknown"', async () => {
    const originalRevision = process.env.PHOTOO_REVISION;
    delete process.env.PHOTOO_REVISION;
    try {
      const response = await app
        .getHttpAdapter()
        .getInstance()
        .inject({ method: 'GET', url: '/v1/does-not-exist' });
      expect(response.headers['x-photoo-revision']).toBe('unknown');

      process.env.PHOTOO_REVISION = 'deadbeef';
      const responseWithRevision = await app
        .getHttpAdapter()
        .getInstance()
        .inject({ method: 'GET', url: '/v1/does-not-exist' });
      expect(responseWithRevision.headers['x-photoo-revision']).toBe('deadbeef');
    } finally {
      if (originalRevision === undefined) {
        delete process.env.PHOTOO_REVISION;
      } else {
        process.env.PHOTOO_REVISION = originalRevision;
      }
    }
  });
});
