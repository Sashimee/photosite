import { randomUUID } from 'node:crypto';
import type { ArgumentsHost } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../monitoring/sentry-report.js', () => ({
  reportException: vi.fn(),
}));

function buildHost(requestId = randomUUID()) {
  const send = vi.fn();
  const status = vi.fn(() => ({ send }));
  const request = { id: requestId, url: '/v1/widgets/boom', method: 'GET' };
  const reply = { status };
  const host = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => reply,
    }),
  } as unknown as ArgumentsHost;
  return { host, status, send };
}

describe('AllExceptionsFilter', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('does not include an eventId when Sentry reports nothing', async () => {
    const { reportException } = await import('../monitoring/sentry-report.js');
    vi.mocked(reportException).mockReturnValue(undefined);
    const { AllExceptionsFilter } = await import('./all-exceptions.filter.js');

    const logger = { error: vi.fn() } as unknown as Logger;
    const filter = new AllExceptionsFilter(logger);
    const { host, status, send } = buildHost();

    filter.catch(new Error('leaked internals: password=hunter2'), host);

    expect(status).toHaveBeenCalledWith(500);
    const body = send.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(body.code).toBe('INTERNAL_SERVER_ERROR');
    expect(body.message).toBe('Internal server error');
    expect('eventId' in body).toBe(false);
    expect(JSON.stringify(body)).not.toMatch(/hunter2/);
  });

  it('carries the Sentry event id on a 500, without the original message or stack', async () => {
    const { reportException } = await import('../monitoring/sentry-report.js');
    vi.mocked(reportException).mockReturnValue('event-123');
    const { AllExceptionsFilter } = await import('./all-exceptions.filter.js');

    const logger = { error: vi.fn() } as unknown as Logger;
    const filter = new AllExceptionsFilter(logger);
    const { host, send } = buildHost();

    filter.catch(new Error('leaked internals: password=hunter2'), host);

    const body = send.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(body).toEqual({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Internal server error',
      requestId: expect.any(String) as string,
      eventId: 'event-123',
    });
  });

  it('never reports or attaches an eventId for a non-5xx exception', async () => {
    const { BadRequestException } = await import('@nestjs/common');
    const { reportException } = await import('../monitoring/sentry-report.js');
    const { AllExceptionsFilter } = await import('./all-exceptions.filter.js');

    const logger = { error: vi.fn() } as unknown as Logger;
    const filter = new AllExceptionsFilter(logger);
    const { host, status, send } = buildHost();

    filter.catch(new BadRequestException('bad input'), host);

    expect(status).toHaveBeenCalledWith(400);
    expect(reportException).not.toHaveBeenCalled();
    const body = send.mock.calls[0]?.[0] as Record<string, unknown>;
    expect('eventId' in body).toBe(false);
  });
});
