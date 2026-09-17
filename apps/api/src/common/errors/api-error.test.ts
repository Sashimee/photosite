import { BadRequestException, HttpException, HttpStatus, NotFoundException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { buildApiErrorBody, normalizeException } from './api-error.js';

describe('normalizeException', () => {
  it('uses the structured code, message and details carried by an HttpException', () => {
    const exception = new HttpException(
      {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: [{ path: 'name' }],
      },
      HttpStatus.BAD_REQUEST,
    );

    expect(normalizeException(exception)).toEqual({
      status: 400,
      code: 'VALIDATION_ERROR',
      message: 'Request validation failed',
      details: [{ path: 'name' }],
    });
  });

  it('derives a stable code for a plain Nest exception', () => {
    const exception = new NotFoundException('Booking not found');
    const result = normalizeException(exception);
    expect(result.status).toBe(404);
    expect(result.code).toBe('NOT_FOUND');
    expect(result.message).toBe('Booking not found');
  });

  it('falls back to a generic code for an unmapped status', () => {
    const exception = new HttpException('teapot', 418);
    expect(normalizeException(exception).code).toBe('ERROR');
  });

  it('handles an HttpException created with only a string body', () => {
    const exception = new BadRequestException('bad input');
    const result = normalizeException(exception);
    expect(result.code).toBe('BAD_REQUEST');
    expect(result.message).toBe('bad input');
  });

  it('never leaks a stack trace and maps any other error to a generic 500', () => {
    const result = normalizeException(new Error('leaked internals: password=hunter2'));
    expect(result).toEqual({
      status: 500,
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Internal server error',
    });
  });

  it('treats a non-Error throw the same way', () => {
    expect(normalizeException('boom').code).toBe('INTERNAL_SERVER_ERROR');
  });
});

describe('buildApiErrorBody', () => {
  it('omits details when none are given', () => {
    const body = buildApiErrorBody('NOT_FOUND', 'Not found', 'req-1');
    expect(body).toEqual({ code: 'NOT_FOUND', message: 'Not found', requestId: 'req-1' });
    expect('details' in body).toBe(false);
  });

  it('includes details when given', () => {
    const body = buildApiErrorBody('VALIDATION_ERROR', 'Invalid', 'req-1', { field: 'name' });
    expect(body).toEqual({
      code: 'VALIDATION_ERROR',
      message: 'Invalid',
      details: { field: 'name' },
      requestId: 'req-1',
    });
  });
});
