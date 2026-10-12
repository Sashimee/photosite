import type { ExecutionContext } from '@nestjs/common';
import { HttpException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { FetchOnlyGuard } from './fetch-only-guard.js';

function contextWith(headers: Record<string, string>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ headers }) }),
  } as unknown as ExecutionContext;
}

function rejection(headers: Record<string, string>): unknown {
  try {
    new FetchOnlyGuard().canActivate(contextWith(headers));
  } catch (error) {
    return error;
  }
  return undefined;
}

describe('FetchOnlyGuard', () => {
  it.each([
    { 'sec-fetch-mode': 'cors', 'sec-fetch-site': 'same-site' },
    { 'sec-fetch-mode': 'cors', 'sec-fetch-site': 'same-origin' },
    { 'sec-fetch-mode': 'same-origin' },
    {},
  ])('allows %o', (headers) => {
    expect(new FetchOnlyGuard().canActivate(contextWith(headers))).toBe(true);
  });

  it.each([
    { 'sec-fetch-mode': 'navigate', 'sec-fetch-site': 'cross-site' },
    { 'sec-fetch-mode': 'navigate', 'sec-fetch-site': 'same-site' },
    { 'sec-fetch-mode': 'navigate', 'sec-fetch-site': 'none' },
    { 'sec-fetch-mode': 'navigate' },
    { 'sec-fetch-mode': 'cors', 'sec-fetch-site': 'cross-site' },
    { 'sec-fetch-mode': 'no-cors', 'sec-fetch-site': 'none' },
    { 'sec-fetch-site': 'cross-site' },
    { 'sec-fetch-site': '' },
  ])('refuses %o with 403 FORBIDDEN', (headers) => {
    const error = rejection(headers);
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(403);
    expect((error as HttpException).getResponse()).toMatchObject({ code: 'FORBIDDEN' });
  });
});
