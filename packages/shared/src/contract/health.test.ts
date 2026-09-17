import { describe, expect, it } from 'vitest';
import { HealthResponseSchema, ReadyResponseSchema } from './health.js';

describe('HealthResponseSchema', () => {
  it('accepts the ok status', () => {
    expect(HealthResponseSchema.safeParse({ status: 'ok' }).success).toBe(true);
  });

  it('rejects any other status', () => {
    expect(HealthResponseSchema.safeParse({ status: 'degraded' }).success).toBe(false);
  });

  it('rejects unknown keys', () => {
    expect(HealthResponseSchema.safeParse({ status: 'ok', uptime: 12 }).success).toBe(false);
  });
});

describe('ReadyResponseSchema', () => {
  it('accepts ok checks for database and redis', () => {
    expect(
      ReadyResponseSchema.safeParse({
        status: 'ok',
        checks: { database: 'ok', redis: 'ok' },
      }).success,
    ).toBe(true);
  });

  it('rejects a non-ok check', () => {
    expect(
      ReadyResponseSchema.safeParse({
        status: 'ok',
        checks: { database: 'down', redis: 'ok' },
      }).success,
    ).toBe(false);
  });

  it('rejects unknown keys', () => {
    expect(
      ReadyResponseSchema.safeParse({
        status: 'ok',
        checks: { database: 'ok', redis: 'ok' },
        latencyMs: 5,
      }).success,
    ).toBe(false);
  });
});
