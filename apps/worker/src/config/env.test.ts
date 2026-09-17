import { describe, expect, it } from 'vitest';
import { loadEnv } from './env.js';

const validEnv = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://user:pass@127.0.0.1:5432/photoo',
  REDIS_URL: 'redis://127.0.0.1:6379',
  WEB_APP_URL: 'http://localhost:3000',
  S3_ENDPOINT: 'http://127.0.0.1:9000',
  S3_REGION: 'eu-west-1',
  S3_ACCESS_KEY_ID: 'photoo_dev',
  S3_SECRET_ACCESS_KEY: 'photoo_dev_password',
  S3_FORCE_PATH_STYLE: 'true',
  S3_PRIVATE_BUCKET: 'photoo-private',
  S3_PUBLIC_BUCKET: 'photoo-public',
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
    expect(env.CLAMAV_SCAN_TIMEOUT_MS).toBe(30_000);
    expect(env.CLAMAV_MAX_SCAN_BYTES).toBe(25 * 1024 * 1024);
    expect(env.UPLOADS_CLEANUP_INTERVAL_MS).toBe(10 * 60 * 1000);
    expect(env.IMAGE_PROCESS_MAX_PIXELS).toBe(100_000_000);
    expect(env.S3_ENDPOINT).toBe('http://127.0.0.1:9000');
    expect(env.S3_FORCE_PATH_STYLE).toBe(true);
    expect(env.S3_PRIVATE_BUCKET).toBe('photoo-private');
    expect(env.S3_PUBLIC_BUCKET).toBe('photoo-public');
  });

  it('defaults S3_FORCE_PATH_STYLE to false when unset', () => {
    const withoutFlag: Record<string, string> = { ...validEnv };
    delete withoutFlag.S3_FORCE_PATH_STYLE;
    expect(loadEnv(withoutFlag).S3_FORCE_PATH_STYLE).toBe(false);
  });

  it('rejects a missing S3_ENDPOINT', () => {
    const withoutEndpoint: Record<string, string> = { ...validEnv };
    delete withoutEndpoint.S3_ENDPOINT;
    expect(() => loadEnv(withoutEndpoint)).toThrow(/S3_ENDPOINT/);
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

  it('defaults SMTP settings to Mailpit outside production', () => {
    const env = loadEnv(validEnv);
    expect(env.SMTP_HOST).toBe('localhost');
    expect(env.SMTP_PORT).toBe(1025);
    expect(env.SMTP_SECURE).toBe(false);
    expect(env.SMTP_FROM).toBe('dev@photoo.lu');
    expect(env.SMTP_USER).toBeUndefined();
    expect(env.SMTP_PASSWORD).toBeUndefined();
  });

  it('rejects production without explicit SMTP settings', () => {
    expect(() => loadEnv({ ...validEnv, NODE_ENV: 'production' })).toThrow(/SMTP_HOST/);
  });

  it('accepts production with every SMTP variable set', () => {
    const env = loadEnv({
      ...validEnv,
      NODE_ENV: 'production',
      SMTP_HOST: 'smtp-relay.brevo.com',
      SMTP_PORT: '587',
      SMTP_SECURE: 'false',
      SMTP_USER: 'apikey',
      SMTP_PASSWORD: 'secret',
      SMTP_FROM: 'no-reply@photoo.lu',
    });
    expect(env.SMTP_HOST).toBe('smtp-relay.brevo.com');
    expect(env.SMTP_SECURE).toBe(false);
  });
});
