import { describe, expect, it } from 'vitest';
import { loadEnv } from './env.js';

const validEnv = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://user:pass@127.0.0.1:5432/photoo',
  REDIS_URL: 'redis://127.0.0.1:6379',
};

describe('loadEnv', () => {
  it('parses a well-formed environment and fills in sane defaults', () => {
    const env = loadEnv(validEnv);
    expect(env.NODE_ENV).toBe('development');
    expect(env.DATABASE_URL).toBe(validEnv.DATABASE_URL);
    expect(env.REDIS_URL).toBe(validEnv.REDIS_URL);
    expect(env.HEALTH_PORT).toBe(4100);
    expect(env.CLAMAV_HOST).toBe('127.0.0.1');
    expect(env.CLAMAV_PORT).toBe(3310);
    expect(env.WORKER_CONCURRENCY_FILE_SCAN).toBe(2);
    expect(env.WORKER_CONCURRENCY_IMAGE_PROCESS).toBe(2);
    expect(env.WORKER_CONCURRENCY_UPLOADS_CLEANUP).toBe(1);
  });

  it('rejects a missing NODE_ENV', () => {
    const withoutNodeEnv: Record<string, string> = { ...validEnv };
    delete withoutNodeEnv.NODE_ENV;
    expect(() => loadEnv(withoutNodeEnv)).toThrow(/NODE_ENV/);
  });

  it('rejects a missing DATABASE_URL', () => {
    const withoutDatabaseUrl: Record<string, string> = { ...validEnv };
    delete withoutDatabaseUrl.DATABASE_URL;
    expect(() => loadEnv(withoutDatabaseUrl)).toThrow(/DATABASE_URL/);
  });

  it('rejects a malformed REDIS_URL', () => {
    expect(() => loadEnv({ ...validEnv, REDIS_URL: 'not-a-url' })).toThrow(/REDIS_URL/);
  });

  it('rejects a non-numeric WORKER_CONCURRENCY_FILE_SCAN', () => {
    expect(() => loadEnv({ ...validEnv, WORKER_CONCURRENCY_FILE_SCAN: 'lots' })).toThrow(
      /WORKER_CONCURRENCY_FILE_SCAN/,
    );
  });

  it('rejects a zero concurrency', () => {
    expect(() => loadEnv({ ...validEnv, WORKER_CONCURRENCY_IMAGE_PROCESS: '0' })).toThrow(
      /WORKER_CONCURRENCY_IMAGE_PROCESS/,
    );
  });

  it('parses explicit overrides for HEALTH_PORT, CLAMAV_* and concurrency', () => {
    const env = loadEnv({
      ...validEnv,
      HEALTH_PORT: '4200',
      CLAMAV_HOST: 'clamav.internal',
      CLAMAV_PORT: '4310',
      WORKER_CONCURRENCY_FILE_SCAN: '5',
      WORKER_CONCURRENCY_IMAGE_PROCESS: '3',
      WORKER_CONCURRENCY_UPLOADS_CLEANUP: '4',
    });
    expect(env.HEALTH_PORT).toBe(4200);
    expect(env.CLAMAV_HOST).toBe('clamav.internal');
    expect(env.CLAMAV_PORT).toBe(4310);
    expect(env.WORKER_CONCURRENCY_FILE_SCAN).toBe(5);
    expect(env.WORKER_CONCURRENCY_IMAGE_PROCESS).toBe(3);
    expect(env.WORKER_CONCURRENCY_UPLOADS_CLEANUP).toBe(4);
  });

  it('rejects an unsupported NODE_ENV value', () => {
    expect(() => loadEnv({ ...validEnv, NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
  });
});
